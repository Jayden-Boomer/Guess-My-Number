// PeerJS transport, lobby persistence, recovery, and multiplayer message protocol.
// Loaded before script.js; game state and UI callbacks are used only at runtime.
const network = {
    peer: null,
    connection: null,
    hostCode: null,
    reconnecting: false,
    reconnectTimer: null,
    takeoverHost: false,
    rejoinName: null,
    get peerId() { return this.peer && this.peer.id; },
    get lobbyCode() { return this.hostCode || this.peerId; },
    get connected() { return Boolean(this.connection && this.connection.open); }
};

const LOBBY_COOKIE = "hidden-number-duel-lobby";
const LOBBY_COOKIE_MAX_AGE = 120;

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function peerOptions() {
    const configuredServers = window.HIDDEN_NUMBER_DUEL_TURN?.iceServers;
    const iceServers = Array.isArray(configuredServers) && configuredServers.length
        ? [...DEFAULT_ICE_SERVERS, ...configuredServers]
        : DEFAULT_ICE_SERVERS;
    return { config: { iceServers } };
}

function setLobbyCookie(lobbyCode, nickname = game.nickname, secret = game.secrets[localPlayer()]) {
    if (lobbyCode && nickname) {
        const saved = { nickname, lobbyCode };
        if (Number.isInteger(secret)) saved.secret = secret;
        if (network.rejoinName) saved.rejoinName = network.rejoinName;
        const value = encodeURIComponent(JSON.stringify(saved));
        document.cookie = `${LOBBY_COOKIE}=${value}; Max-Age=${LOBBY_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    }
}
function getLobbyCookie() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith(`${LOBBY_COOKIE}=`));
    if (!cookie) return null;
    try {
        const saved = JSON.parse(decodeURIComponent(cookie.slice(LOBBY_COOKIE.length + 1)));
        if (typeof saved.nickname !== "string" || typeof saved.lobbyCode !== "string" || !saved.nickname || !saved.lobbyCode) return null;
        return {
            nickname: saved.nickname,
            lobbyCode: saved.lobbyCode,
            secret: Number.isInteger(saved.secret) ? saved.secret : null,
            rejoinName: typeof saved.rejoinName === "string" ? saved.rejoinName : null
        };
    } catch { return null; }
}
function clearLobbyCookie() { document.cookie = `${LOBBY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`; }
function send(message) {
    setLobbyCookie(network.hostCode || (network.peer && network.peer.id));
    if (network.connection && network.connection.open) network.connection.send(message);
}
function publicState() {
    return {
        type: "state", names: game.names, maxNumber: game.maxNumber, currentPlayer: game.currentPlayer,
        history: game.history, pendingQuestion: game.pendingQuestion, phase: game.phase,
        winner: game.winner, winningGuess: game.winningGuess
    };
}
function broadcastState() { send(publicState()); }
function watchPeerConnection() {
    const peer = network.peer;
    peer.on("disconnected", () => {
        if (peer !== network.peer) return;
        setStatus("PeerJS connection lost. Reconnecting...", true);
        if (game.role === "guest") {
            promoteGuestToHost();
        } else network.peer.reconnect();
    });
}
function promoteGuestToHost() {
    if (game.role !== "guest" || network.reconnecting) return;
    network.reconnecting = true;
    const previousHostCode = network.hostCode;
    const oldConnection = network.connection;
    const oldPeer = network.peer;
    network.connection = null;
    network.peer = null;
    swapPlayerRoles();
    game.role = "host";
    network.hostCode = previousHostCode;
    if (oldConnection) oldConnection.close();
    if (oldPeer && !oldPeer.destroyed) oldPeer.destroy();
    startHosting(true, previousHostCode);
    showHandoffDialog("The host disconnected, so you are now the host. The match will resume when your opponent rejoins.");
}
function scheduleGuestReconnect() {
    if (network.reconnectTimer || game.role !== "guest") return;
    const savedLobby = getLobbyCookie();
    if (!savedLobby) return;
    network.reconnecting = true;
    network.reconnectTimer = setTimeout(() => {
        network.reconnectTimer = null;
        startJoining(savedLobby.lobbyCode, { textContent: "" });
    }, 1000);
}

function startHosting(resumingMatch = false, lobbyCode = null) {
    if (typeof Peer === "undefined") { renderLobby("host", "PeerJS could not load. Check your internet connection and try again."); return; }
    if (network.reconnectTimer) { clearTimeout(network.reconnectTimer); network.reconnectTimer = null; }
    game.role = "host";
    if (!resumingMatch) game.names = [game.nickname, null];
    network.takeoverHost = resumingMatch;
    network.peer = lobbyCode ? new Peer(lobbyCode, peerOptions()) : new Peer(peerOptions()); renderLobby("host");
    network.reconnecting = false;
    watchPeerConnection();
    network.peer.on("open", () => {
        setLobbyCookie(network.peer.id);
        const code = document.querySelector(".lobby-code");
        if (code) code.textContent = network.peer.id;
        if (resumingMatch && game.phase !== "lobby") renderNetworkState();
    });
    network.peer.on("connection", connection => {
        if (network.connection && network.connection !== connection) network.connection.close();
        network.connection = connection;
        connection.on("open", () => {
            if (game.phase === "lobby") send({ type: "lobby-info", name: game.nickname });
            else send(publicState());
        });
        connection.on("data", handleHostMessage);
        connection.on("close", () => {
            if (network.connection !== connection) return;
            network.connection = null;
            if (game.role === "host") setStatus("Your opponent disconnected.", true);
        });
        connection.on("error", () => setStatus("The connection was interrupted.", true));
    });
    network.peer.on("error", error => setStatus(error.type === "peer-unavailable" ? "That lobby was not found." : "PeerJS could not connect.", true));
}

function startJoining(hostCode, errorElement) {
    if (!hostCode) { errorElement.textContent = "Enter the host lobby code."; return; }
    if (typeof Peer === "undefined") { errorElement.textContent = "PeerJS could not load. Check your internet connection and try again."; return; }
    if (network.reconnectTimer) { clearTimeout(network.reconnectTimer); network.reconnectTimer = null; }
    const savedLobby = getLobbyCookie();
    game.role = "guest"; network.hostCode = hostCode;
    setLobbyCookie(hostCode, game.nickname, savedLobby && savedLobby.lobbyCode === hostCode ? savedLobby.secret : null);
    if (savedLobby && Number.isInteger(savedLobby.secret)) game.secrets[1] = savedLobby.secret;
    if (network.peer && !network.peer.destroyed) network.peer.destroy();
    network.connection = null; network.peer = new Peer(peerOptions()); renderLobby("connecting");
    watchPeerConnection();
    network.peer.on("open", () => {
        const connection = network.peer.connect(hostCode);
        network.connection = connection;
        connection.on("open", () => { network.reconnecting = false; send({ type: "join", name: game.nickname }); });
        connection.on("data", handleGuestMessage);
        connection.on("error", () => setStatus("The connection was interrupted.", true));
        connection.on("close", () => {
            if (network.connection !== connection) return;
            network.connection = null;
            if (game.role === "guest") promoteGuestToHost();
            else renderLobby("join", "The host connection was lost. Rejoin when ready.");
        });
    });
    network.peer.on("error", () => {
        if (game.role === "guest") scheduleGuestReconnect();
        else setStatus("That lobby could not be reached.", true);
    });
}

function handleHostMessage(message) {
    if (message.type === "lobby-info" || message.type === "join") {
        game.names[1] = String(message.name || "Opponent").trim().slice(0, MAX_NICKNAME_LENGTH);
        network.rejoinName = game.names[1];
        setLobbyCookie(network.hostCode || (network.peer && network.peer.id));
        const submit = document.querySelector(".lobby-submit");
        if (submit) { submit.disabled = false; submit.textContent = "Start duel"; }
        setStatus(`${playerName(1)} joined. Set the range when you are ready.`);
        if (message.type === "join" && network.takeoverHost && handoffDialog.open) handoffDialog.close();
        if (message.type === "join" && game.phase !== "lobby") {
            send(publicState());
            send({ type: "secret-request" });
            if (network.takeoverHost) send({ type: "host-takeover", name: game.names[0] });
        }
    } else if (message.type === "secret-set") { game.secrets[1] = message.secret; maybeStartGame(); }
    else if (message.type === "recovery-secret") {
        if (Number.isInteger(message.secret)) game.secrets[1] = message.secret;
        if (game.phase === "setup" && game.secrets[0] !== null && game.secrets[1] !== null) {
            game.phase = "turn";
            broadcastState();
            renderNetworkState();
        }
    }
    else if (message.type === "rematch-request") resetForRematch();
    else if (message.type === "action") processAction(message.action, 1);
}
function handleGuestMessage(message) {
    if (message.type === "host-takeover") {
        showHandoffDialog(`The previous host disconnected. ${message.name || "This player"} is now the host of this lobby.`);
    } else if (message.type === "lobby-info") {
        game.names[0] = String(message.name || "Host").trim().slice(0, MAX_NICKNAME_LENGTH);
        const title = document.querySelector(".lobby-title");
        const copy = document.querySelector(".lobby-copy");
        if (title) title.textContent = "Lobby joined";
        if (copy) copy.textContent = `You are connected to ${playerName(0)}. Wait for the host to choose the range and start the duel.`;
        setStatus("Connected. Waiting for the host to start...");
    } else if (message.type === "host-secret-ready") {
        const copy = document.querySelector(".screen-copy");
        if (copy && game.phase === "setup") copy.textContent = `The host has locked their number. Choose your secret number from 1 to ${game.maxNumber}.`;
    } else if (message.type === "secret-request") {
        if (Number.isInteger(game.secrets[1])) send({ type: "recovery-secret", secret: game.secrets[1] });
    } else if (message.type === "game-start") {
        game.names = message.names; game.maxNumber = message.maxNumber; game.phase = "setup"; setLobbyCookie(network.hostCode, game.nickname); updateRangeDisplay(); renderSecretSetup();
    } else if (message.type === "state") {
        Object.assign(game, message); updateRangeDisplay(); renderNetworkState();
    } else if (message.type === "rematch") {
        resetGuestForRematch();
    }
}

function disconnectNetwork() {
    const { connection, peer, reconnectTimer } = network;
    network.connection = null;
    network.peer = null;
    network.hostCode = null;
    network.reconnecting = false;
    network.reconnectTimer = null;
    network.takeoverHost = false;
    network.rejoinName = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (connection) connection.close();
    if (peer) peer.destroy();
    clearLobbyCookie();
}
