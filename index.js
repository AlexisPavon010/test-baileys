const {
    default: makeWASocket,
    MessageType,
    MessageOptions,
    Mimetype,
    DisconnectReason,
    BufferJSON,
    AnyMessageContent,
    delay,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    MessageRetryMap,
    useMultiFileAuthState,
    msgRetryCounterMap
} = require("@adiwajshing/baileys");

let type = MessageType

// const log = (pino = require("pino"));
const { session } = { "session": "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const app = require("express")()
// enable files upload
app.use(fileUpload({
    createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
    res.sendFile("./client/server.html", {
        root: __dirname,
    });
});

app.get("/", (req, res) => {
    res.sendFile("./client/index.html", {
        root: __dirname,
    });
});
//fungsi suara capital 
function capital(textSound) {
    const arr = textSound.split(" ");
    for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
    }
    const str = arr.join(" ");
    return str;
}
// const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let client;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    let { version, isLatest } = await fetchLatestBaileysVersion();
    client = makeWASocket({
        // printQRInTerminal: true,
        auth: state,
        // logger: log({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    // store.bind(client.ev);
    client.multi = true
    client.ev.on('connection.update', async (update) => {
        // console.log(update);
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
                client.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Connection closed, reconnecting....");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Connection Lost from Server, reconnecting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
                client.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
                client.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Restart Required, Restarting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Connection TimedOut, Reconnecting...");
                connectToWhatsApp();
            } else {
                client.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            let getGroups = await client.groupFetchAllParticipating();
            let groups = Object.entries(getGroups).slice(0).map(entry => entry[1]);
            console.log(groups);
            return;
        } else {
            qr = update.qr
        }
    });
    client.ev.on("creds.update", saveCreds);
    client.ev.on("messages.upsert", async ({ messages, type }) => {
        //console.log(messages);
        if (type === "notify") {
            if (!messages[0].key.fromMe) {
                //tentukan jenis pesan berbentuk text                
                const pesan = messages[0].message.conversation;

                //nowa dari pengirim pesan sebagai id
                const noWa = messages[0].key.remoteJid;

                await client.readMessages([messages[0].key]);

                //kecilkan semua pesan yang masuk lowercase 
                const pesanMasuk = pesan.toLowerCase();

                if (!messages[0].key.fromMe && pesanMasuk === "ping") {
                    await client.sendMessage(noWa, { text: "Pong" }, { quoted: messages[0] });
                } else {
                    await client.sendMessage(noWa, { text: "Saya adalah Bot!" }, { quoted: messages[0] });
                }
            }
        }
    });
}

io.on("connection", async (socket) => {
    soket = socket;
    console.log(isConnected())
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

// functions
const isConnected = () => {
    return (client?.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

// send text message to wa user
app.post("/send-message", async (req, res) => {
    //console.log(req);
    const message = req.body.message;
    const number = req.body.phoneNumber;


    let numberWA;
    try {
        if (!number) {
            res.status(500).json({
                status: false,
                response: 'No hay numero!'
            });
        }
        else {
            // numberWA = '62' + number.substring(1) + "@s.whatsapp.net"; 
            numberWA = number + "@s.whatsapp.net";

            console.log(await client.onWhatsApp(numberWA));
            client.sendMessage(numberWA, { text: message })
                .then((result) => {
                    res.status(200).json({
                        status: true,
                        response: result,
                    });
                })
                .catch((err) => {
                    res.status(500).json({
                        status: false,
                        response: err,
                    });
                });

        }
    } catch (err) {
        console.log(err)
        res.status(500).send(err);
    }

});

connectToWhatsApp()
    .catch(err => console.log("unexpected error: " + err)) // catch any errors
server.listen(port, () => {
    console.log("Server Berjalan pada Port : " + port);
});
