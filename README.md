# Costume Party Voting — Server Handoff

This archive contains the Next.js app (attendee pages, organizer desk, and API), its public image and sound files, Supabase migrations, dependency lockfile, and the configured `.env.local` file.

## Before deployment

Confirm these details with the server administrator:

- SSH hostname, port, and account name
- The directory where the app will live
- Node.js **20.9 or newer** and npm on the server
- The public URL and whether the company proxy will serve the app at the website root or under a child path
- A company-approved way to keep the app running as a service

The server administrator is the only person with the SSH private key. They should run the SSH and upload commands below, or provision an authorized account for you. **Do not put an SSH private key in this archive.**

## 1. Upload the archive

From a Mac terminal, the authorized person can copy the archive to the server. Replace the placeholders with the company-provided details:

```bash
scp -P <SSH_PORT> -i <PATH_TO_AUTHORIZED_SSH_KEY> \
  "Costume-Party-Mentor.zip" \
  <SERVER_USER>@<SERVER_HOST>:/tmp/
```

If the key is already loaded in their SSH agent, omit `-i <PATH_TO_AUTHORIZED_SSH_KEY>`.

## 2. Connect and unpack it

```bash
ssh -p <SSH_PORT> -i <PATH_TO_AUTHORIZED_SSH_KEY> <SERVER_USER>@<SERVER_HOST>
mkdir -p ~/apps/costume-party/release-1
unzip /tmp/Costume-Party-Mentor.zip -d ~/apps/costume-party/release-1
cd ~/apps/costume-party/release-1
```

The archive includes `.env.local`. Restrict access to it, then install the locked dependencies:

```bash
chmod 600 .env.local
node --version
npm --version
npm ci --include=dev
```

Keep `.env.local` in the project root. It contains the Supabase URL and keys, organizer password, and session secret. Do not copy it into `public/` or expose it through the company website.

## 3. Prepare Supabase

The app uses Supabase for event data and live updates. In the Supabase Dashboard’s **SQL Editor**:

- For a database that already has the original app schema, run `supabase/migrations/0002_contestant_name.sql` once.
- For a fresh database, run `0001_costume_party.sql`, then `0002_contestant_name.sql`, in that order.

Existing costume entries receive `TBA` for their new contestant name. Update those rows in Supabase if they are real entries.

## 4. Build and run the app

Build from the project directory:

```bash
npm run build
```

For a quick foreground run behind a reverse proxy on the same server:

```bash
npm run start -- --hostname 127.0.0.1 --port 3000
```

The terminal must stay open while this command runs; `Ctrl+C` stops the app. For event use, have the server administrator register the command with the company’s service manager so it starts after a reboot and restarts if it exits. Ask them to configure the company reverse proxy to forward the public app URL to `http://127.0.0.1:3000`.

## Public URL and child paths

The current app expects the website root of its host, such as `https://voting.company.example/`. It uses root-relative API and media paths. If the company wants to mount it beneath another site, such as `https://company.example/costume-party/`, the app needs a matching Next.js `basePath` and prefixed API/media paths **before it is built**. The server administrator should provide the exact public path so that configuration can be set. A reverse-proxy rule alone will not make the current root-relative paths work under a child path.

After the proxy is configured, open the public URL, sign in through **Organizer**, add a test contestant and costume, start a round, and check that an iPhone on the event Wi-Fi follows the same session. Generate the attendee QR code from the final public URL.

## Updating the deployment

Upload a fresh archive into a new release directory, install dependencies, build, then ask the administrator to point the service at that release and restart it. Preserve the server’s `.env.local` if deployment credentials have changed since this archive was made.
