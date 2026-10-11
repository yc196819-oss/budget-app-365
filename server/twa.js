// Google Play packages the web app as a Trusted Web Activity. Android opens
// it full screen only when the site lists the app's package and signing key
// in /.well-known/assetlinks.json. Pure.

const PACKAGE = 'com.budget365.app';
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// sha256: one or more SHA-256 fingerprints (comma separated), as Play Console
// shows them ("AB:CD:…", 32 pairs). Null when none is valid.
function assetLinks(pkg, sha256) {
  const prints = String(sha256 || '').split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter((x) => FINGERPRINT.test(x));
  if (!prints.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: (pkg || PACKAGE).trim(), sha256_cert_fingerprints: prints }
  }];
}

module.exports = { PACKAGE, assetLinks };
