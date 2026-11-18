#import <AppKit/AppKit.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <libproc.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <atomic>
#include <memory>
#include <string>
#include <vector>
#include "levels.hpp"
#include "remote.hpp"

namespace {
napi_value boolean(napi_env env, bool x) {
    napi_value result;
    napi_get_boolean(env, x, &result);
    return result;
}
napi_value resultObject(napi_env env, bool ok, const std::string &message) {
    napi_value object, text;
    napi_create_object(env, &object);
    napi_create_string_utf8(env, message.c_str(), message.size(), &text);
    napi_set_named_property(env, object, "ok", boolean(env, ok));
    napi_set_named_property(env, object, "message", text);
    return object;
}

char glassKey;
napi_value attachGlass(napi_env env, napi_callback_info info) {
    if (@available(macOS 26, *)) {
        size_t argc = 2, length = 0;
        napi_value args[2];
        void *handle = nullptr;
        napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
        if (![NSThread isMainThread] || !argc ||
            napi_get_buffer_info(env, args[0], &handle, &length) != napi_ok ||
            !handle || length != sizeof(void *)) return boolean(env, false);
        void *pointer = nullptr;
        memcpy(&pointer, handle, length);
        NSView *electron = (__bridge NSView *)pointer;
        NSView *root = electron.window.contentView;
        if (!root) return boolean(env, false);

        double radius = 24;
        if (argc == 2) napi_get_value_double(env, args[1], &radius);
        NSGlassEffectView *glass = objc_getAssociatedObject(root, &glassKey);
        if (!glass) {
            glass = [[NSGlassEffectView alloc] initWithFrame:root.bounds];
            glass.style = NSGlassEffectViewStyleRegular;
            glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
            [root addSubview:glass positioned:NSWindowBelow relativeTo:nil];
            objc_setAssociatedObject(root, &glassKey, glass, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        glass.cornerRadius = std::clamp(radius, 0., 80.);
        return boolean(env, true);
    }
    return boolean(env, false);
}

AudioObjectPropertyAddress property(AudioObjectPropertySelector selector) {
    return { selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
}

template <typename T>
bool getProperty(AudioObjectID id, AudioObjectPropertySelector selector, T &value) {
    auto address = property(selector);
    UInt32 bytes = sizeof(value);
    return AudioObjectGetPropertyData(id, &address, 0, nullptr, &bytes, &value) == noErr;
}

bool isOwnAudioProcess(pid_t pid, NSString *bundlePrefix) {
    if (pid == getpid()) return true;
    char executable[PROC_PIDPATHINFO_MAXSIZE];
    if (!bundlePrefix || proc_pidpath(pid, executable, sizeof(executable)) <= 0 ||
        ![[NSString stringWithUTF8String:executable] hasPrefix:bundlePrefix]) return false;

    // A different running copy can have the same executable path. Check the parent chain too.
    for (int i = 0; i < 32 && pid > 1; ++i) {
        struct proc_bsdinfo process{};
        if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &process, sizeof(process)) != sizeof(process)) return false;
        pid = process.pbi_ppid;
        if (pid == getpid()) return true;
    }
    return false;
}

NSArray<NSNumber *> *ownAudioObjects() {
    auto address = property(kAudioHardwarePropertyProcessObjectList);
    UInt32 bytes = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &bytes) != noErr || !bytes) return @[];
    std::vector<AudioObjectID> objects(bytes / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &bytes, objects.data()) != noErr) return @[];
    NSMutableArray<NSNumber *> *own = [NSMutableArray array];
    NSString *prefix = [NSBundle.mainBundle.bundlePath stringByAppendingString:@"/Contents/"];
    for (size_t index = 0; index < bytes / sizeof(AudioObjectID); ++index) {
        pid_t pid = 0;
        if (getProperty(objects[index], kAudioProcessPropertyPID, pid) && isOwnAudioProcess(pid, prefix)) {
            [own addObject:@(objects[index])];
        }
    }
    return own;
}

struct Tap {
    AudioObjectID tap = kAudioObjectUnknown;
    AudioObjectID device = kAudioObjectUnknown;
    AudioDeviceIOProcID proc = nullptr;
    bool started = false;
    std::unique_ptr<prism::Levels> meter;
    std::atomic<float> values[3]{};
    std::atomic<uint64_t> lastHostTime{0};

    static OSStatus receive(AudioObjectID, const AudioTimeStamp *now, const AudioBufferList *input,
        const AudioTimeStamp *, AudioBufferList *, const AudioTimeStamp *, void *context) {
        auto *self = static_cast<Tap *>(context);
        if (!input || !input->mNumberBuffers) return noErr;
        const AudioBuffer &buffer = input->mBuffers[0]; // private mono, float32 tap
        if (!buffer.mData || buffer.mNumberChannels != 1) return noErr;
        auto levels = self->meter->read(static_cast<const float *>(buffer.mData), buffer.mDataByteSize / sizeof(float));
        for (int i = 0; i < 3; ++i) self->values[i].store(levels[i], std::memory_order_relaxed);
        self->lastHostTime.store(now->mHostTime, std::memory_order_release);
        return noErr;
    }

    std::string start() API_AVAILABLE(macos(14.2)) {
        NSArray<NSNumber *> *own = ownAudioObjects();
        if (!own.count) return "Play a song in YouTube Music first, then enable audio-reactive glass.";
        CATapDescription *description = [[CATapDescription alloc] initMonoMixdownOfProcesses:own];
        description.privateTap = YES;
        description.exclusive = NO;
        description.muteBehavior = CATapUnmuted;
        description.name = @"YouTube Music audio-reactive glass";
        if (@available(macOS 26, *)) description.processRestoreEnabled = NO;
        if (AudioHardwareCreateProcessTap(description, &tap) != noErr)
            return "macOS could not start YouTube Music’s audio tap. Check System Settings → Privacy & Security → Screen & System Audio Recording.";

        AudioStreamBasicDescription format{};
        if (!getProperty(tap, kAudioTapPropertyFormat, format) ||
            format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) ||
            format.mBitsPerChannel != 32 || format.mChannelsPerFrame != 1 || format.mSampleRate < 8000) {
            return "The current output device returned an unsupported audio format.";
        }
        meter = std::make_unique<prism::Levels>(format.mSampleRate);
        NSDictionary *aggregate = @{
            @kAudioAggregateDeviceNameKey: @"YouTube Music analysis",
            @kAudioAggregateDeviceUIDKey: NSUUID.UUID.UUIDString,
            @kAudioAggregateDeviceIsPrivateKey: @YES,
            @kAudioAggregateDeviceTapListKey: @[@{ @kAudioSubTapUIDKey: description.UUID.UUIDString }]
        };
        if (AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregate, &device) != noErr ||
            AudioDeviceCreateIOProcID(device, receive, this, &proc) != noErr ||
            AudioDeviceStart(device, proc) != noErr) {
            return "YouTube Music could not read its audio output. Check audio recording access in System Settings and try again.";
        }
        started = true;
        return {};
    }

    ~Tap() {
        if (started) AudioDeviceStop(device, proc);
        if (proc) AudioDeviceDestroyIOProcID(device, proc);
        if (device) AudioHardwareDestroyAggregateDevice(device);
        if (@available(macOS 14.2, *)) {
            if (tap) AudioHardwareDestroyProcessTap(tap);
        }
    }
};

std::unique_ptr<Tap> running;
unsigned generation = 0;
bool pending = false;

struct StartRequest {
    napi_async_work work;
    napi_deferred promise;
    unsigned generation;
    std::unique_ptr<Tap> tap;
    std::string error;
};
void createTap(napi_env, void *context) {
    auto *request = static_cast<StartRequest *>(context);
    @autoreleasepool {
        if (@available(macOS 14.2, *)) {
            request->tap = std::make_unique<Tap>();
            request->error = request->tap->start();
        } else {
            request->error = "Audio-reactive glass requires macOS 14.2 or later.";
        }
    }
}
void tapCreated(napi_env env, napi_status status, void *context) {
    std::unique_ptr<StartRequest> request(static_cast<StartRequest *>(context));
    pending = false;
    if (status != napi_ok || request->generation != generation) request->error = "Audio analysis was stopped.";
    if (request->error.empty()) running = std::move(request->tap);
    napi_resolve_deferred(env, request->promise, resultObject(env, request->error.empty(),
        request->error.empty() ? "YouTube Music is measuring its own playback." : request->error));
    napi_delete_async_work(env, request->work);
}

napi_value startAudio(napi_env env, napi_callback_info) {
    napi_value promise;
    napi_deferred deferred;
    napi_create_promise(env, &deferred, &promise);
    if (pending || running) {
        const bool ready = running != nullptr;
        napi_resolve_deferred(env, deferred, resultObject(env, ready, ready ? "Audio analysis is active." : "Audio access is still starting."));
        return promise;
    }
    auto request = std::make_unique<StartRequest>();
    request->generation = generation;
    request->promise = deferred;
    napi_value name;
    napi_create_string_utf8(env, "Start YouTube Music audio tap", NAPI_AUTO_LENGTH, &name);
    if (napi_create_async_work(env, nullptr, name, createTap, tapCreated, request.get(), &request->work) != napi_ok ||
        napi_queue_async_work(env, request->work) != napi_ok) {
        if (request->work) napi_delete_async_work(env, request->work);
        napi_resolve_deferred(env, deferred, resultObject(env, false, "Audio analysis could not start."));
        return promise;
    }
    pending = true;
    request.release();
    return promise;
}
napi_value readEnergy(napi_env env, napi_callback_info) {
    const char *bands[] = {"bass", "mid", "treble"};
    napi_value out;
    napi_create_object(env, &out);
    bool fresh = false;
    if (running) {
        const uint64_t last = running->lastHostTime.load(std::memory_order_acquire);
        fresh = last && static_cast<double>(AudioGetCurrentHostTime() - last) / AudioGetHostClockFrequency() < .35;
    }
    for (int i = 0; i < 3; ++i) {
        napi_value value;
        napi_create_double(env, fresh ? running->values[i].load(std::memory_order_relaxed) : 0, &value);
        napi_set_named_property(env, out, bands[i], value);
    }
    return out;
}
void cleanup(void *) {
    ++generation;
    running.reset();
}
napi_value stopAudio(napi_env env, napi_callback_info) {
    cleanup(nullptr);
    napi_value none;
    napi_get_undefined(env, &none);
    return none;
}
napi_value init(napi_env env, napi_value exports) {
    napi_add_env_cleanup_hook(env, cleanup, nullptr);
    prism::registerRemote(env, exports);
    for (auto [name, handler] : std::initializer_list<std::pair<const char *, napi_callback>>{
        {"attachGlass", attachGlass}, {"startAudio", startAudio}, {"stopAudio", stopAudio}, {"readEnergy", readEnergy}}) {
        napi_value fn;
        napi_create_function(env, name, NAPI_AUTO_LENGTH, handler, nullptr, &fn);
        napi_set_named_property(env, exports, name, fn);
    }
    return exports;
}
}
NAPI_MODULE(prism, init)

