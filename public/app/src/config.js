// Public client configuration. The Supabase anon key is meant to be public:
// what a user can read or write is enforced by Row Level Security in the
// database, not by hiding this key. (Same values the current app uses.)
export const CONFIG = {
  supabaseUrl: 'https://bwwupwbakefjhwropdin.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3d3Vwd2Jha2Vmamh3cm9wZGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MjgyNzYsImV4cCI6MjA5ODIwNDI3Nn0.-x9BYvkn-21jCr6CIrnh15m9gAUfIS3GMVNbrPuznBE',
  // The AI server is this same origin. There is deliberately no way to
  // override it from the browser.
  apiBase: '',
  // Who sees the owner's dashboard: fingerprints (SHA-256) of the owners'
  // emails, not the addresses themselves. The server checks again.
  ownerHashes: ['8ff0b3475c30a05f1ea79f5ef44dfb52fc75db4e5f1b3bb09c06111f902bbd33', '1b7e1165d7b1de7d108a92534c4fabc7795d132f0db4c97c8241efd892b39cda']
};
