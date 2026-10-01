// Public client configuration. The Supabase anon key is meant to be public:
// what a user can read or write is enforced by Row Level Security in the
// database, not by hiding this key. (Same values the current app uses.)
export const CONFIG = {
  supabaseUrl: 'https://bwwupwbakefjhwropdin.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3d3Vwd2Jha2Vmamh3cm9wZGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MjgyNzYsImV4cCI6MjA5ODIwNDI3Nn0.-x9BYvkn-21jCr6CIrnh15m9gAUfIS3GMVNbrPuznBE',
  // The AI server is this same origin. There is deliberately no way to
  // override it from the browser.
  apiBase: ''
};
