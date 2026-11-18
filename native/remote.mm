#import <MediaPlayer/MediaPlayer.h>
#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <vector>
#include "remote.hpp"

namespace prism {
namespace {
struct Command {
    const char *action;
    double position;
};

// The OS can deliver commands on any queue. Only the Node thread touches JavaScript.
class Receiver {
    std::mutex lock;
    napi_threadsafe_function callback;
public:
    explicit Receiver(napi_threadsafe_function fn) : callback(fn) {}
    MPRemoteCommandHandlerStatus send(const char *name, double position) {
        std::lock_guard guard(lock);
        if (!callback) return MPRemoteCommandHandlerStatusCommandFailed;
        auto event = std::make_unique<Command>(Command{name, position});
        if (napi_call_threadsafe_function(callback, event.get(), napi_tsfn_nonblocking) != napi_ok)
            return MPRemoteCommandHandlerStatusCommandFailed;
        event.release();
        return MPRemoteCommandHandlerStatusSuccess;
    }
    void close() {
        std::lock_guard guard(lock);
        if (callback) napi_release_threadsafe_function(callback, napi_tsfn_abort);
        callback = nullptr;
    }
};

typedef MPRemoteCommandHandlerStatus (^CommandHandler)(MPRemoteCommandEvent *);
struct Registration {
    MPRemoteCommand *command;
    id token;
#if defined(PRISM_REMOTE_TEST)
    const char *action;
    CommandHandler handler;
#endif
};
std::vector<Registration> registrations;
std::shared_ptr<Receiver> receiver;
bool hasMetadata = false;

void deliver(napi_env env, napi_value jsCallback, void *, void *data) {
    std::unique_ptr<Command> event(static_cast<Command *>(data));
    if (!env || !jsCallback) return; // environment shut down with a queued event
    napi_value args[2], self;
    napi_create_string_utf8(env, event->action, NAPI_AUTO_LENGTH, &args[0]);
    napi_create_double(env, event->position, &args[1]);
    napi_get_undefined(env, &self);
    size_t argc = std::isfinite(event->position) ? 2 : 1;
    napi_call_function(env, self, jsCallback, argc, args, nullptr);
}

void setEnabled(bool enabled, bool canSeek) {
    MPRemoteCommand *seek = MPRemoteCommandCenter.sharedCommandCenter.changePlaybackPositionCommand;
    for (const auto &binding : registrations) {
        binding.command.enabled = enabled && (binding.command != seek || canSeek);
    }
}
void clearMetadata() {
    if (!hasMetadata) return;
    auto *center = MPNowPlayingInfoCenter.defaultCenter;
    center.playbackState = MPNowPlayingPlaybackStateStopped;
    center.nowPlayingInfo = nil;
    hasMetadata = false;
    setEnabled(false, false);
}
void cleanup(void *) {
    if (!receiver) return;
    receiver->close();
    clearMetadata();
    for (const auto &binding : registrations) {
        [binding.command removeTarget:binding.token];
        binding.command.enabled = NO;
    }
    registrations.clear();
    receiver.reset();
}
void bind(MPRemoteCommand *command, const char *name) {
    const auto owner = receiver;
    CommandHandler handler = ^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        double time = NAN;
        if ([event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) {
            time = ((MPChangePlaybackPositionCommandEvent *)event).positionTime;
        }
        return owner->send(name, time);
    };
    command.enabled = NO;
    id token = [command addTargetWithHandler:handler];
    registrations.push_back({command, token
#if defined(PRISM_REMOTE_TEST)
        , name, handler
#endif
    });
}

napi_value initRemote(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value cb, name;
    napi_valuetype type;
    napi_get_cb_info(env, info, &argc, &cb, nullptr, nullptr);
    if (argc != 1 || napi_typeof(env, cb, &type) != napi_ok || type != napi_function) {
        napi_throw_type_error(env, nullptr, "initRemote expects a command callback");
        return nullptr;
    }
    cleanup(nullptr);
    napi_create_string_utf8(env, "Prism media key", NAPI_AUTO_LENGTH, &name);
    napi_threadsafe_function function;
    if (napi_create_threadsafe_function(env, cb, nullptr, name, 32, 1, nullptr, nullptr,
                                         nullptr, deliver, &function) != napi_ok) {
        napi_throw_error(env, nullptr, "Could not register Mac media controls");
        return nullptr;
    }
    napi_unref_threadsafe_function(env, function);
    receiver = std::make_shared<Receiver>(function);
    auto *center = MPRemoteCommandCenter.sharedCommandCenter;
    bind(center.playCommand, "play");
    bind(center.pauseCommand, "pause");
    bind(center.togglePlayPauseCommand, "toggle");
    bind(center.nextTrackCommand, "next");
    bind(center.previousTrackCommand, "previous");
    bind(center.changePlaybackPositionCommand, "seek");
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

NSString *textField(napi_env env, napi_value metadata, const char *name) {
    napi_value field;
    char text[2048];
    size_t bytes = 0;
    if (napi_get_named_property(env, metadata, name, &field) != napi_ok ||
        napi_get_value_string_utf8(env, field, text, sizeof(text), &bytes) != napi_ok)
        return @"";
    return [[NSString alloc] initWithBytes:text length:bytes encoding:NSUTF8StringEncoding] ?: @"";
}
double numberField(napi_env env, napi_value metadata, const char *name) {
    napi_value field;
    double value = 0;
    napi_get_named_property(env, metadata, name, &field);
    napi_get_value_double(env, field, &value);
    return std::isfinite(value) ? std::max(0., value) : 0.;
}
napi_value updateNowPlaying(napi_env env, napi_callback_info info) {
    napi_value none, data;
    napi_get_undefined(env, &none);
    if (!receiver) return none;
    size_t count = 1;
    napi_valuetype type;
    napi_get_cb_info(env, info, &count, &data, nullptr, nullptr);
    if (!count || napi_typeof(env, data, &type) != napi_ok || type != napi_object) {
        clearMetadata();
        return none;
    }
    napi_value playingField;
    bool playing = false;
    napi_get_named_property(env, data, "playing", &playingField);
    napi_get_value_bool(env, playingField, &playing);
    const double duration = numberField(env, data, "duration");
    const double position = numberField(env, data, "position");
    auto *center = MPNowPlayingInfoCenter.defaultCenter;
    NSMutableDictionary *metadata = [@{
        MPMediaItemPropertyTitle: textField(env, data, "title"),
        MPMediaItemPropertyArtist: textField(env, data, "artist"),
        MPMediaItemPropertyAlbumTitle: textField(env, data, "album"),
        MPNowPlayingInfoPropertyExternalContentIdentifier: textField(env, data, "id"),
        MPNowPlayingInfoPropertyMediaType: @(MPNowPlayingInfoMediaTypeAudio),
        MPNowPlayingInfoPropertyElapsedPlaybackTime: @(position),
        MPNowPlayingInfoPropertyDefaultPlaybackRate: @1,
        MPNowPlayingInfoPropertyPlaybackRate: @(playing ? 1 : 0)
    } mutableCopy];
    if (duration > 0) metadata[MPMediaItemPropertyPlaybackDuration] = @(duration);
    center.nowPlayingInfo = metadata;
    auto playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
    if (!hasMetadata || center.playbackState != playbackState) center.playbackState = playbackState;
    hasMetadata = true;
    setEnabled(true, duration > 0);
    return none;
}
napi_value disposeRemote(napi_env env, napi_callback_info) {
    cleanup(nullptr);
    napi_value none;
    napi_get_undefined(env, &none);
    return none;
}
#if defined(PRISM_REMOTE_TEST)
// Exercise the exact block registered with MPRemoteCommandCenter without sending
// a system-wide hardware key that might instead control another application.
napi_value testToggle(napi_env env, napi_callback_info) {
    bool sent = false;
    for (const auto &binding : registrations) {
        if (!strcmp(binding.action, "toggle")) sent = binding.handler(nil) == MPRemoteCommandHandlerStatusSuccess;
    }
    napi_value result;
    napi_get_boolean(env, sent, &result);
    return result;
}
#endif
}
void registerRemote(napi_env env, napi_value exports) {
    napi_add_env_cleanup_hook(env, cleanup, nullptr);
    for (const auto &[name, callback] : std::initializer_list<std::pair<const char *, napi_callback>>{
        {"initRemote", initRemote}, {"updateNowPlaying", updateNowPlaying}, {"disposeRemote", disposeRemote}
#if defined(PRISM_REMOTE_TEST)
        , {"testToggle", testToggle}
#endif
    }) {
        napi_value fn;
        napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &fn);
        napi_set_named_property(env, exports, name, fn);
    }
}
}

