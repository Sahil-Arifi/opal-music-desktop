const test = require('node:test');
const assert = require('node:assert/strict');
const {artURL} = require('../src/renderer/types.ts');

const proxied = (address, pixels) => new URL(artURL(address, pixels), 'https://fixture.local').searchParams.get('url');

test('music CDN renditions preserve dimensions, source options, and signed query parameters', () => {
  const cdn = 'https://yt3.googleusercontent.com/';
  assert.equal(proxied(cdn+'album-id=w120-h120-l90-rj',640),cdn+'album-id=w640-h640-l90-rj');
  assert.equal(proxied(cdn+'album-id=w160-h90-k-no?token=abc',1280),cdn+'album-id=w1280-h720-k-no?token=abc');
  assert.equal(proxied(cdn+'album-id=s96-c-k-c0x00ffffff-no-rj',640),cdn+'album-id=s640-c-k-c0x00ffffff-no-rj');
  assert.equal(proxied(cdn+'album-id/w120-h120-p/file.jpg',640),cdn+'album-id/w640-h640-p/file.jpg');
  assert.equal(proxied(cdn+'album-id=c-w120-h120-l90-rj',800),cdn+'album-id=c-w800-h800-l90-rj');
  for (const address of [cdn+'album-id=s0',cdn+'album-id=w1200-h1200-l90-rj',cdn+'my-art-w120-h120-hash']) {
    assert.equal(proxied(address,640),address);
  }
});

test('large video covers use a higher resolution still from the same video, retaining signed or alternate frames', () => {
  const video = 'https://i.ytimg.com/vi/EVfrrugW8JI/';
  assert.equal(proxied(video+'hqdefault.jpg',800),video+'maxresdefault.jpg');
  assert.equal(proxied(video+'hqdefault.jpg',192),video+'hqdefault.jpg');
  for (const frame of ['hqdefault.jpg?token=signed','hq1.jpg','maxresdefault.jpg']) {
    assert.equal(proxied(video+frame,800),video+frame);
  }
  assert.equal(artURL('/reference/red.svg',800),'/reference/red.svg');
});

