# OpenHamClock WSJT-X Relay Agent

Bridges your local WSJT-X instance to a remote OpenHamClock server.

WSJT-X sends decoded FT8/FT4/JT65/WSPR messages via UDP, which only works on the local network. This relay agent captures those UDP packets on your machine and forwards them to your cloud-hosted OpenHamClock instance (e.g. openhamclock.com) over HTTPS.

## How It Works

```text
WSJT-X  ──UDP──►  relay.js (your PC)  ──HTTPS──►  openhamclock.com
                   port 2237                        /api/wsjtx/relay
```

## Quick Start

This assumes that you are loading Openhamclock from a server that is configured to provide a WSJT-X relay. See [the main README](../README.md#wsjt-x-relay-agent) if you need to configure a relay in your own server.

### 1. Configure Openhamclock to use multicast if you need it

If you have more than one listening application on your system, you will need to configure wsjt-x to use multicast, as well as all of the listener applications.
For Openhamclock, in the `Station Settings` enable `Use multicast address`. If you are using an address other than the default, you should also set that.

### 2. Download the relay command

In the WSJT-X tab of the PSK Reporter, you will see a screen with buttons to download the relay comand. If you have configured to use multicast for this, the address will be noted in this tab. Select the button that is labelled with the Operatng System that you are running. This will download a script that will start the relay to your Downloads folder.

### 3. Download node.js

You will need `node.js` to be able to run the relay. To do this

| Operating System.    | Instruction                                    |
| -------------------- | ---------------------------------------------- |
| Ubuntu/Debian.       | `sudo apt install nodejs`                      |
| Fedora               | `sudo dnf install nodejs`                      |
| Mac (using homebrew) | `brew install node`                            |
| Windows              | The batch script will download it if necessary |

### 4. Start the relay

#### Linux

```bash
chmod +x start-relay.sh
./start-relay.sh
```

#### Mac

```bash
chmod +x start-relay.command
./start-relay.command
```

#### Windows

## Enabling the Relay on your server

On your OpenHamClock server, set the `WSJTX_RELAY_KEY` environment variable:

```bash
# In .env file or docker-compose environment:
WSJTX_RELAY_KEY=your-secret-key-here
```

Pick any strong random string. It never leaves the server: each relay gets a token derived from this key and its browser session (the downloaded script already contains it), and that token only works for its own session. Changing the key invalidates every relay token — re-download the relay afterwards.

## Configure WSJT-X

In WSJT-X:

1. Go to **Settings → Reporting**
2. Under **UDP Server**:
   - Address: `127.0.0.1`
   - Port: `2237`
   - ☑ Accept UDP requests

   Note that if you are using multicast, you should use a multicast address (like `224.0.0.1`) for the address.

That's it. The relay will show decoded messages as they come in.

## Requirements

- **Node.js 14+** (no npm install needed — zero dependencies)
- WSJT-X, JTDX, or any software that speaks the WSJT-X UDP protocol

-- ## Running as a Service

Note, if you want the relay to listen to a multicast group, you need to include the line mentioning `MULTICAST`, and replace the address there with the one you are using. If you only want to listen to unicast servers, leave the line out.

### Linux (systemd)

```ini
# /etc/systemd/system/wsjtx-relay.service
[Unit]
Description=OpenHamClock WSJT-X Relay
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/relay.js
Environment=OPENHAMCLOCK_URL=https://openhamclock.com
Environment=RELAY_KEY=your-secret-key
Environment=MULTICAST=224.0.0.1 # If you want the relay to listen to multicast
Restart=always
RestartSec=5
User=your-username

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now wsjtx-relay
```

### Windows (Task Scheduler)

Create a batch file `start-relay.bat`:

```batch
@echo off
set OPENHAMCLOCK_URL=https://openhamclock.com
set RELAY_KEY=your-secret-key
set MULTICAST=224.0.0.1 # If you want the relay to listen to multicast
node C:\path\to\relay.js
```

Add it to Task Scheduler to run at login.

## Troubleshooting

**Port already in use**: Another program is listening on 2237. Use `--port 2238` and update WSJT-X to match, or configure to use multicast.

**Connection errors**: The relay automatically retries with backoff. Check that your server URL is correct and accessible.

**No decodes showing**: Make sure WSJT-X is set to UDP address `127.0.0.1` (or the multicast address thaht you specified) port `2237`, and that the "Accept UDP requests" checkbox is enabled.
