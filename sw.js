/* ---------------------------------------------------------------------------
   BC MOTT Radio Call Sign Directory - service worker

   Two jobs:
     1. satisfy Chrome's installability check, so Add to Home Screen produces a
        real standalone app rather than a browser bookmark
     2. make the hosted copy work with no signal, which is the whole point of
        the product and is NOT true without this file

   Strategy is stale-while-revalidate: serve from cache instantly, then refresh
   the cache in the background. A tester always gets a fast load and an offline
   load, and picks up a new build on their next visit.

   BUMP CACHE_VERSION EVERY TIME YOU UPLOAD A NEW rcb_callbook.html.
   Without that, testers keep the old build and report bugs you have fixed.
--------------------------------------------------------------------------- */

var CACHE_VERSION = "rcb-31August2026";

/* Same-folder assets. Paths are relative so this works wherever the document
   library puts the folder. Failures are tolerated - SharePoint may refuse any
   one of these and the worker must still install. */
var PRECACHE = [
  "index.html",
  "rcb-b3.webmanifest",
  "rcb-icon-b2-192.png",
  "rcb-icon-b2-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (c) {
      /* addAll rejects the whole batch if one item 404s, so add individually */
      return Promise.all(
        PRECACHE.map(function (u) {
          return c.add(new Request(u, { cache: "reload" }))["catch"](function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          return k === CACHE_VERSION ? null : caches["delete"](k);
        })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;

  /* Only handle our own origin, and only GET. Everything else - the weather
     API, DriveBC, Environment Canada tiles, SharePoint auth - goes straight to
     the network, because caching a stale road event is worse than none. */
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (_e) { return; }
  if (url.origin !== self.location.origin) return;

  /* Never cache SharePoint's own machinery or anything with a query string,
     which on SPO usually means an auth or versioning parameter. */
  if (url.pathname.indexOf("/_layouts/") > -1 ||
      url.pathname.indexOf("/_api/") > -1 ||
      url.pathname.indexOf("/_vti_") > -1) return;

  /* version.json is the update check itself - serving it from cache would mean
     the app could never notice a new build. Always straight to the network. */
  if (url.pathname.indexOf("version.json") > -1) return;

  e.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        var live = fetch(req).then(function (res) {
          /* opaque and error responses must not replace a good cached copy */
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone())["catch"](function () {});
          }
          return res;
        })["catch"](function () {
          return hit || Response.error();
        });
        /* cache first when we have it; network when we do not */
        return hit || live;
      });
    })
  );
});

/* The refresh button in the header asks for this. A plain reload cannot beat
   the cache - fetch() with cache:"reload" bypasses the HTTP cache, and putting
   the result back is what actually replaces the stored build. */
self.addEventListener("message", function (e) {
  if (e.data === "skipWaiting") { self.skipWaiting(); return; }
  if (e.data && e.data.type === "refresh") {
    e.waitUntil(
      caches.open(CACHE_VERSION).then(function (c) {
        return Promise.all(
          PRECACHE.map(function (u) {
            return fetch(new Request(u, { cache: "reload" })).then(function (r) {
              if (r && r.status === 200) return c.put(u, r.clone());
            })["catch"](function () {});
          })
        );
      }).then(function () {
        if (e.source) e.source.postMessage({ type: "refreshed" });
      })["catch"](function () {
        if (e.source) e.source.postMessage({ type: "refreshed" });
      })
    );
  }
});
