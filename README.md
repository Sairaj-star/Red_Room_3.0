# 🔴 RED ROOM 3.0

A hotel-style private real-time chat platform with exactly **500 fixed rooms**.

## Features
- Customer / Owner reception
- 500 fixed rooms with live available / occupied / full status
- Booking with letters-only name, exactly 10-digit phone, and room capacity
- 9-character room keys
- Invite guests with the key only
- Capacity enforcement
- Real-time Socket.IO text chat
- Edit and delete your own text messages
- Scrollable chat with previous messages
- Images, videos and voice notes
- Explicit Exit Room action
- Entry/exit audit events
- Owner desk with booking, occupancy, audit, messages and media
- Mobile responsive UI
- `/health` endpoint
- Render deployment configuration

## Local
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your private owner credentials into `.env`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Render
Use a Node Web Service:
- Build: `npm install`
- Start: `npm start`
- Health check: `/health`
- Add `OWNER_EMAIL`, `OWNER_PASSWORD`, and a strong `SESSION_SECRET` as environment variables.

## Storage limitation
This build uses a JSON database and local media directory so it remains simple and free to run locally. Render's free web-service filesystem is ephemeral, so a restart/redeploy can remove local room history and media. For long-term public use, replace the file persistence/media layer with an external database and object storage, or another persistent storage option supported by the host.

## Security
Keep `.env` private. Use a strong owner password and session secret. Uploads are type/size limited. No web application can guarantee absolute anonymity or prevent screenshots/copies by participants.
