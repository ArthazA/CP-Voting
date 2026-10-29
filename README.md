# Costume Party Voting

Next.js app for the attendee voting page, private host desk, live screen, and winner reveal. Event state and votes are stored in Supabase.

## Run locally

1. In Terminal, go to the project folder:

   ```bash
   cd "/Users/master/Documents/VScode Files/CP Voting"
   ```

2. Install the project dependencies:

   ```bash
   npm ci
   ```

3. Make sure `.env.local` is in the project root with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ORGANIZER_PASSWORD`, and `SESSION_SECRET` set. Keep `.env.local` private and out of `public/`.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open these pages in your browser:

   - `http://localhost:3000/` — attendee page
   - `http://localhost:3000/host` — private host desk
   - `http://localhost:3000/live` — big-screen live view
   - `http://localhost:3000/reveal` — winner reveal

There is intentionally no host link on the attendee page. Bookmark `/host` on your organizer device and sign in with the organizer password.

### Test with an iPhone on the same Wi-Fi

The `dev` script listens on the MacBook’s network interfaces. Find the MacBook’s local IP address (on many Macs, run `ipconfig getifaddr en0`), then open the app from the iPhone using that address.

On the iPhone, open `http://<MACBOOK-LAN-IP>:3000/` (replace the placeholder with the MacBook’s address). Both devices need to be on a network that allows them to connect to each other; the MacBook firewall may ask you to allow incoming connections.

The QR image at `public/vote-qr.png` is static and encodes one fixed URL. For a local phone test, either type the MacBook address directly or temporarily replace that image with a QR code for `http://<MACBOOK-LAN-IP>:3000/`. Restore the event QR image before deploying.

For the live camera test, open `/live` on the MacBook at `http://localhost:3000/live`, allow camera access, and select the iPhone camera. Camera access requires HTTPS or localhost; the MacBook LAN address over plain HTTP is suitable for attendee page testing, but not for the browser camera. Use full screen (F) and mirror the Mac display to the event screen.

## Supabase setup

In the Supabase Dashboard’s SQL Editor, apply migrations once, in order:

- **Fresh database:** run `0001_costume_party.sql` through `0006_reveal_for_everyone.sql` in numeric order.
- **Existing database:** run only the migration files that have not already completed, continuing in numeric order. If the last completed file was `0003_planned_order.sql`, the next files are `0004_scare_to_impress.sql`, `0005_host_only_vote_updates.sql`, and `0006_reveal_for_everyone.sql`.

The migrations add the base voting tables and live updates, contestant names, planned order, group tags and editable votes, host-only vote-count updates, and shared winner reveal. Do not rerun migrations that already completed successfully.

## Event pages

- `/` is the attendee voting and reaction page.
- `/host` is the organizer desk. It requires the organizer password and has no link from the attendee screen.
- `/live` is the big-screen catwalk view, with camera feed, timer, reactions, ticker, and QR image.
- `/reveal` is the staged winner reveal. The host can share each reveal step with attendee and live screens.

The app supports any number of contestants. It is designed to run at the root of its own host name, for example `https://costume.company.example/`. The paths above are routes on that same subdomain. Hosting it beneath another website path such as `/costume-party/` requires path-prefix support in the app and server configuration.

## Build and run on the company server

Install dependencies and build from the project directory:

```bash
npm ci --include=dev
npm run build
```

Start the built app behind the company reverse proxy:

```bash
npm run start -- --hostname 127.0.0.1 --port 3000
```

For the event, ask the server administrator to configure the company service manager to keep the app running and restart it if needed. The reverse proxy should route the app’s dedicated subdomain to `http://127.0.0.1:3000`. Keep `.env.local` on the server with restricted permissions; do not include it in a public archive or place it under `public/`.
