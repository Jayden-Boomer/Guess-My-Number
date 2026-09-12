const DEFAULT_MAX_NUMBER = 50;
const MAX_ENDPOINT = 1000;
const MAX_NICKNAME_LENGTH = 24;
const NICKNAME_COOKIE = "hidden-number-duel-nickname";
const NICKNAME_COOKIE_MAX_AGE = 315360000;
let lobbyToastTimer = null;
let lobbyToastRemoveTimer = null;
let noteHighlightTimer = null;
const answerNotes = new Map();
const game = {
    role: null,
    nickname: "",
    secrets: [null, null],
    names: [null, null],
    currentPlayer: 0,
    maxNumber: DEFAULT_MAX_NUMBER,
    history: [],
    pendingQuestion: null,
    questionDraft: "",
    phase: "lobby",
    winner: null,
    winningGuess: null
};

const gameCard = document.getElementById("gameCard");
const rulesDialog = document.getElementById("rulesDialog");
const numberlineSettingsDialog = document.getElementById("numlineSettingsDialog");
const showNumberlineNotes = document.getElementById("showNumberlineNotes");
const showNumberlineLabels = document.getElementById("showNumberlineLabels");
const numberlineCompression = document.getElementById("numberlineCompression");
const handoffDialog = document.getElementById("handoffDialog");
const handoffCloseButton = document.querySelector(".close-handoff-dialog");
let handoffDialogManualCloseAllowed = false;
const numberWords = new Set([
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "first", "second",
    "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "half",
    "quarter", "double", "triple"
]);

function restrictToDigits(input) {
    // Number inputs also accept signs, decimals, and exponent notation by default.
    input.addEventListener("keydown", event => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey
            && event.key.length === 1 && /[^0-9]/.test(event.key)) event.preventDefault();
    });
    input.addEventListener("beforeinput", event => {
        if (event.data && /[^0-9]/.test(event.data)) event.preventDefault();
    });
    input.addEventListener("paste", event => {
        if (event.clipboardData && /[^0-9]/.test(event.clipboardData.getData("text"))) event.preventDefault();
    });
    input.addEventListener("drop", event => {
        if (event.dataTransfer && /[^0-9]/.test(event.dataTransfer.getData("text"))) event.preventDefault();
    });
    input.addEventListener("input", () => {
        // Cover input methods that bypass the cancellable events above.
        if (input.validity.badInput || /[^0-9]/.test(input.value)) input.value = "";
    });
}
function cloneTemplate(id) {
    const view = document.getElementById(id).content.cloneNode(true);
    view.querySelectorAll('input[type="number"]').forEach(restrictToDigits);
    return view;
}
function playerName(index) { return game.names[index] || "this player"; }
function opponentOf(index) { return index === 0 ? 1 : 0; }
function swapPlayerRoles() {
    game.secrets.reverse();
    game.names.reverse();
    game.currentPlayer = opponentOf(game.currentPlayer);
    if (game.pendingQuestion) {
        game.pendingQuestion = {
            ...game.pendingQuestion,
            asker: opponentOf(game.pendingQuestion.asker),
            answerer: opponentOf(game.pendingQuestion.answerer)
        };
    }
    game.history = game.history.map(item => item.type === "question"
        ? { ...item, asker: opponentOf(item.asker), answerer: opponentOf(item.answerer) }
        : { ...item, player: opponentOf(item.player) });
    if (game.winner !== null) game.winner = opponentOf(game.winner);
}
function localPlayer() { return game.role === "host" ? 0 : 1; }
function updateRangeDisplay() {
    document.getElementById("rangeDisplay").textContent = `1–${game.maxNumber}`;
    document.getElementById("rangeRule").textContent = `Each player secretly chooses a number from 1 to ${game.maxNumber}.`;
}
function setStatus(message, isError = false) {
    const status = document.querySelector(".lobby-status");
    if (status) { status.textContent = message; status.classList.toggle("error", isError); }
}
function showLobbyJoinNotification(playerNameText, customMessage = null) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    if (lobbyToastTimer) window.clearTimeout(lobbyToastTimer);
    if (lobbyToastRemoveTimer) window.clearTimeout(lobbyToastRemoveTimer);
    container.innerHTML = "";

    const toast = document.createElement("div");
    toast.className = "lobby-toast";
    toast.textContent = customMessage || `${playerNameText} joined the lobby`;
    container.appendChild(toast);

    window.setTimeout(() => toast.classList.add("visible"), 20);
    lobbyToastTimer = window.setTimeout(() => {
        toast.classList.remove("visible");
        lobbyToastRemoveTimer = window.setTimeout(() => {
            container.innerHTML = "";
            lobbyToastTimer = null;
            lobbyToastRemoveTimer = null;
        }, 220);
    }, 2600);
}
function setNicknameCookie(nickname) {
    if (nickname) document.cookie = `${NICKNAME_COOKIE}=${encodeURIComponent(nickname)}; Max-Age=${NICKNAME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}
function notifyOpponentGuess(item) {
    if (item && item.type === "guess" && item.player !== localPlayer()) {
        showLobbyJoinNotification(playerName(item.player), `${playerName(item.player)} guessed ${item.guess}`);
    }
}
function getNicknameCookie() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith(`${NICKNAME_COOKIE}=`));
    if (!cookie) return "";
    try {
        return decodeURIComponent(cookie.slice(NICKNAME_COOKIE.length + 1)).slice(0, MAX_NICKNAME_LENGTH);
    } catch { return ""; }
}
function showHandoffDialog(copy, allowManualClose = false) {
    handoffDialogManualCloseAllowed = allowManualClose;
    const closeButton = handoffCloseButton || document.querySelector(".close-handoff-dialog");
    handoffDialog.querySelector(".handoff-copy").textContent = copy;
    if (closeButton) {
        closeButton.hidden = !allowManualClose;
        closeButton.disabled = !allowManualClose;
        closeButton.setAttribute("aria-hidden", String(!allowManualClose));
    }
    if (!handoffDialog.open) handoffDialog.showModal();
}
function renderStart() {
    gameCard.closest(".app-shell").classList.remove("is-playing");
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = "";
    gameCard.appendChild(cloneTemplate("startTemplate"));
    const form = gameCard.querySelector(".start-form");
    const modeButtons = [...gameCard.querySelectorAll(".lobby-mode-btn")];
    const joinField = gameCard.querySelector(".join-code-field");
    const nickname = gameCard.querySelector("#startNickname");
    const error = gameCard.querySelector(".error");
    nickname.maxLength = MAX_NICKNAME_LENGTH;
    nickname.value = getNicknameCookie();
    const savedLobby = getLobbyCookie();
    if (savedLobby) {
        checkLobbyAvailability(savedLobby.lobbyCode).then(availability => {
            if (!availability || !form.isConnected) return;
            const rejoinSeparator = document.createElement("div");
            rejoinSeparator.className = "rejoin-separator";
            rejoinSeparator.textContent = "or";
            const rejoinButton = document.createElement("button");
            rejoinButton.type = "button";
            rejoinButton.className = "ghost-btn wide-btn rejoin-btn";
            rejoinButton.textContent = `Rejoin ${availability.name || savedLobby.rejoinName || savedLobby.nickname}'s lobby`;
            joinField.after(rejoinSeparator, rejoinButton);
            rejoinButton.addEventListener("click", () => {
                nickname.value = savedLobby.nickname;
                game.nickname = savedLobby.nickname;
                modeButtons.find(button => button.dataset.mode === "join").click();
                gameCard.querySelector("#hostCode").value = savedLobby.lobbyCode;
                startJoining(savedLobby.lobbyCode, error);
            });
        });
    }
    let selectedMode = "host";
    modeButtons.forEach(button => button.addEventListener("click", () => {
        selectedMode = button.dataset.mode;
        modeButtons.forEach(modeButton => {
            const isActive = modeButton === button;
            modeButton.classList.toggle("active", isActive);
            modeButton.setAttribute("aria-pressed", String(isActive));
        });
        joinField.classList.toggle("hidden", selectedMode !== "join");
    }));
    form.addEventListener("submit", event => {
        event.preventDefault();
        game.nickname = nickname.value.trim().slice(0, MAX_NICKNAME_LENGTH);
        if (!game.nickname) { error.textContent = "Enter a nickname first."; nickname.focus(); return; }
        setNicknameCookie(game.nickname);
        if (selectedMode === "host") startHosting();
        else startJoining(gameCard.querySelector("#hostCode").value.trim(), error);
    });
    const sharedLobbyCode = new URLSearchParams(window.location.search).get("lobby");
    if (sharedLobbyCode) {
        const joinButton = modeButtons.find(button => button.dataset.mode === "join");
        joinButton.click();
        gameCard.querySelector("#hostCode").value = sharedLobbyCode;
    }
    setTimeout(() => nickname.focus(), 0);
}

function renderLobby(role, errorMessage = "") {
    gameCard.closest(".app-shell").classList.remove("is-playing");
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = "";
    const view = cloneTemplate("lobbyTemplate");
    const badge = view.querySelector(".lobby-badge");
    const title = view.querySelector(".lobby-title");
    const copy = view.querySelector(".lobby-copy");
    const code = view.querySelector(".lobby-code");
    const copyCodeButton = view.querySelector(".copy-code-btn");
    const shareLinkButton = view.querySelector(".share-link-btn");
    const form = view.querySelector(".lobby-form");
    const input = view.querySelector("#lobbyInput");
    const range = view.querySelector(".lobby-range");
    const rangeInput = view.querySelector("#lobbyRangeInput");
    const label = view.querySelector(".lobby-input-label");
    const submit = view.querySelector(".lobby-submit");
    const errorText = view.querySelector(".error");
    if (role === "host") {
        badge.textContent = "Host lobby"; title.textContent = "Your lobby is ready";
        copy.textContent = "Share this code with your opponent. When they arrive, choose the range and start the duel.";
        code.textContent = network.peerId || "Connecting..."; code.classList.remove("hidden");
        copyCodeButton.classList.remove("hidden");
        shareLinkButton.classList.remove("hidden");
        copyCodeButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(code.textContent);
                showLobbyJoinNotification(null, "Lobby code copied to your clipboard.");
                copyCodeButton.setAttribute("aria-label", "Lobby code copied");
                copyCodeButton.title = "Lobby code copied";
                setTimeout(() => {
                    copyCodeButton.setAttribute("aria-label", "Copy lobby code");
                    copyCodeButton.title = "Copy lobby code";
                }, 1600);
            } catch {
                setStatus("Copy failed. Select the lobby code and copy it manually.", true);
            }
        });
        shareLinkButton.addEventListener("click", async () => {
            const inviteUrl = new URL(window.location.href);
            inviteUrl.search = "";
            inviteUrl.searchParams.set("lobby", code.textContent);
            try {
                if (navigator.share) await navigator.share({ title: "Hidden Number Duel", text: "Join my duel", url: inviteUrl.href });
                else {
                    await navigator.clipboard.writeText(inviteUrl.href);
                    setStatus("Share link copied to your clipboard.");
                }
            } catch (error) {
                if (error.name !== "AbortError") setStatus("Could not share the lobby link.", true);
            }
        });
        label.textContent = "Lobby status"; input.classList.add("hidden"); input.removeAttribute("required");
        range.classList.remove("hidden");
        const opponentConnected = Boolean(network.connected && game.names[1]);
        submit.textContent = opponentConnected ? "Start duel" : "Waiting for opponent";
        submit.disabled = !opponentConnected;
        setStatus(opponentConnected ? `${playerName(1)} joined. Set the range when you are ready.` : "Waiting for an opponent to join...");
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => {
            event.preventDefault();
            const maxNumber = Number(rangeInput.value);
            if (!Number.isInteger(maxNumber) || maxNumber < 2 || maxNumber > MAX_ENDPOINT) { errorText.textContent = `Choose a whole-number endpoint from 2 to ${MAX_ENDPOINT}.`; return; }
            game.maxNumber = maxNumber; game.phase = "setup"; updateRangeDisplay();
            setLobbyCookie(network.peerId, game.nickname);
            send({ type: "game-start", maxNumber, names: game.names }); renderSecretSetup();
        });
    } else if (role === "connecting" || role === "connected") {
        badge.textContent = "Join lobby";
        title.textContent = role === "connected" ? "Lobby joined" : "Joining lobby";
        copy.textContent = role === "connected"
            ? `You are connected to ${playerName(0)}. Wait for the host to choose the range and start the duel.`
            : "Your lobby code was submitted. We are connecting you to the host now.";
        label.textContent = "Connection status";
        input.classList.add("hidden");
        input.removeAttribute("required");
        submit.classList.add("hidden");
        errorText.textContent = errorMessage;
        view.querySelector(".lobby-status").textContent = role === "connected"
            ? "Connected. Waiting for the host to start..."
            : "Connecting to the host...";
    } else {
        badge.textContent = "Join lobby"; title.textContent = "Connect to your opponent";
        copy.textContent = "Enter the host code exactly as it appears on their screen.";
        label.textContent = "Host lobby code"; input.placeholder = "Paste the host code"; input.value = network.hostCode || "";
        submit.textContent = network.hostCode ? "Rejoin lobby" : "Join lobby";
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => { event.preventDefault(); startJoining(input.value.trim(), errorText); });
    }
    gameCard.appendChild(view);
}

function renderSecretSetup() {
    gameCard.closest(".app-shell").classList.remove("is-playing");
    const currentInput = document.querySelector("#secretInput");
    const currentError = document.querySelector(".error");
    const preservedValue = currentInput ? currentInput.value : "";
    const preservedError = currentError ? currentError.textContent : "";

    document.querySelector(".range-pill").classList.remove("hidden"); gameCard.innerHTML = "";
    const view = cloneTemplate("setupTemplate");
    view.querySelector(".step-badge").textContent = "Secret number";
    view.querySelector(".screen-title").textContent = "Choose your secret number";
    view.querySelector(".screen-copy").textContent = `Pick any whole number from 1 to ${game.maxNumber}. Your opponent will never receive it.`;
    view.querySelector("#setupNickname").textContent = game.nickname;
    const form = view.querySelector(".secret-form");
    const input = view.querySelector("#secretInput"); const error = view.querySelector(".error"); input.max = game.maxNumber;
    form.addEventListener("submit", event => {
        event.preventDefault(); const value = Number(input.value);
        if (!Number.isInteger(value) || value < 1 || value > game.maxNumber) { error.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; return; }
        const index = localPlayer(); game.secrets[index] = value;
        if (game.role === "host") {
            send({ type: "host-secret-ready" });
            maybeStartGame();
        }
        else { send({ type: "secret-set", secret: value }); renderWaiting("Secret number locked", "Waiting for the host to start the first turn."); }
    });
    const savedLobby = getLobbyCookie();
    const savedSecret = game.role === "guest" && savedLobby && savedLobby.nickname === game.nickname
        && savedLobby.lobbyCode === (network.lobbyCode)
        ? savedLobby.secret
        : null;
    if (Number.isInteger(savedSecret) && savedSecret >= 1 && savedSecret <= game.maxNumber) {
        input.value = savedSecret;
        game.secrets[localPlayer()] = savedSecret;
    } else if (game.secrets[localPlayer()] === null && preservedValue.trim() !== "") {
        input.value = preservedValue;
        if (preservedError) error.textContent = preservedError;
    }
    gameCard.appendChild(view); setTimeout(() => input.focus(), 0);
}
function maybeStartGame() {
    if (game.secrets[0] === null || game.secrets[1] === null) {
        if (game.role === "host" && game.secrets[0] === null) {
            const currentInput = document.querySelector("#secretInput");
            if (currentInput) return;
            renderSecretSetup();
            return;
        }
        renderWaiting("Secret number locked", `Waiting for ${game.secrets[0] === null ? playerName(0) : playerName(1)} to choose a number.`); return;
    }
    game.phase = "turn"; game.currentPlayer = 0; broadcastState(); renderNetworkState();
}
function renderWaiting(title, copy) {
    gameCard.innerHTML = ""; const view = cloneTemplate("handoffTemplate");
    view.querySelector(".screen-title").textContent = title; view.querySelector(".screen-copy").textContent = copy;
    appendConversation(view, Boolean(game.pendingQuestion));
    gameCard.appendChild(view);
}
function renderNetworkState() {
    gameCard.closest(".app-shell").classList.toggle("is-playing", game.phase === "turn" || game.phase === "finished");
    if (game.phase === "setup") return renderSecretSetup();
    if (game.phase === "finished") return renderWinner(game.winner, game.winningGuess);
    if (game.pendingQuestion) {
        if (game.pendingQuestion.answerer === localPlayer()) renderAnswer();
        else renderWaiting("Question sent", `Waiting for ${playerName(game.pendingQuestion.answerer)} to answer.`);
        return;
    }
    if (game.currentPlayer === localPlayer()) renderTurn();
    else if (game.winner !== null) {
        renderWaiting("You guessed correctly!", `${playerName(game.currentPlayer)} has one final guess to tie the game.`);
    }
    else {
        const latestAnswer = game.history[game.history.length - 1];
        if (latestAnswer && latestAnswer.type === "guess" && latestAnswer.player === localPlayer() && !latestAnswer.correct) {
            renderWaiting(
                `You guessed ${latestAnswer.guess}`,
                `Your guess was incorrect. Waiting for ${playerName(game.currentPlayer)} to ask a question or make a guess.`
            );
        } else if (latestAnswer && latestAnswer.type === "question" && latestAnswer.answerer === game.currentPlayer) {
            renderWaiting(
                `You asked: “${latestAnswer.question}”`,
                `${playerName(latestAnswer.answerer)} answered: “${latestAnswer.answer}.”\nWaiting for ${playerName(latestAnswer.answerer)}'s next question.`
            );
        } else {
            renderWaiting("Opponent's turn", `${playerName(game.currentPlayer)} is deciding whether to ask a question or make a guess.`);
        }
    }
}
function containsForbiddenNumber(text) {
    if (/\d/.test(text)) return true;
    const words = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
    return words.some(word => numberWords.has(word));
}
function saveQuestionDraft() {
    const questionInput = document.querySelector("#questionInput");
    if (questionInput) game.questionDraft = questionInput.value;
}
function submitAction(action) { if (game.role === "host") processAction(action, 0); else send({ type: "action", action }); }
function processAction(action, player) {
    const isAnswer = action.type === "answer" && game.pendingQuestion && game.pendingQuestion.answerer === player;
    if (game.phase !== "turn" || (game.currentPlayer !== player && !isAnswer)) return;
    if (game.pendingQuestion && !isAnswer) return;
    if (game.winner !== null && action.type !== "guess") return;
    if (action.type === "question") game.pendingQuestion = { asker: player, answerer: opponentOf(player), question: action.question };
    else if (action.type === "answer" && game.pendingQuestion && game.pendingQuestion.answerer === player) {
        game.history.push({ type: "question", ...game.pendingQuestion, answer: action.answer }); game.currentPlayer = player; game.pendingQuestion = null;
    } else if (action.type === "guess") {
        if (!Number.isInteger(action.guess) || action.guess < 1 || action.guess > game.maxNumber) return;
        if (incorrectGuesses(player).has(action.guess)) return;
        const correct = action.guess === game.secrets[opponentOf(player)];
        game.history.push({ type: "guess", player, guess: action.guess, correct });
        notifyOpponentGuess(game.history[game.history.length - 1]);
        if (game.winner !== null) {
            game.phase = "finished";
            if (correct) { game.winner = null; game.winningGuess = null; }
        } else {
            if (correct) { game.winner = player; game.winningGuess = action.guess; }
            game.currentPlayer = opponentOf(player);
        }
    } else return;
    broadcastState(); renderNetworkState();
}

function incorrectGuesses(player) {
    return new Set(game.history.filter(item => item.type === "guess" && item.player === player && !item.correct).map(item => item.guess));
}

function createNumberLineScale(excludedNote = null) {
    const max = game.maxNumber;
    let lower = 1, upper = max;
    answerNotes.forEach((note, index) => {
        const item = game.history[index];
        if (index === excludedNote || item?.type !== "question" || item.asker !== localPlayer()) return;
        if (note.direction === "above") lower = Math.max(lower, note.value);
        if (note.direction === "below") upper = Math.min(upper, note.value);
    });
    const conflict = lower > upper;
    if (conflict) { lower = 1; upper = max; }
    // Half-number boundaries leave room even when only one candidate remains.
    const start = Math.max(1, lower - 0.5);
    const end = Math.min(max, upper + 0.5);
    // With compression off, every number occupies equal space.
    const compression = showNumberlineNotes.value !== "none" && numberlineCompression.checked ? 0.5 : 1;
    const left = compression * (start - 1) / (max - 1);
    const right = compression * (max - end) / (max - 1);
    const values = [1, start, end, max];
    const positions = [0, left, 1 - right, 1];
    function interpolate(value, from, to) {
        value = Math.max(from[0], Math.min(from[3], value));
        for (let i = 1; i < from.length; i++) {
            if (value <= from[i] && from[i] > from[i - 1]) {
                return to[i - 1] + (value - from[i - 1]) / (from[i] - from[i - 1]) * (to[i] - to[i - 1]);
            }
        }
        return to[3];
    }
    return {
        position: value => interpolate(value, values, positions),
        number: position => Math.round(interpolate(position, positions, values)),
        left: interpolate(lower, values, positions),
        right: 1 - interpolate(upper, values, positions),
        description: showNumberlineNotes.value === "none" ? "" : conflict ? "Notes conflict; showing the full range evenly." :
            lower > 1 || upper < max ? `Notes suggest ${lower}–${upper}. ${numberlineCompression.checked ? "Other numbers are compressed at the ends; all numbers remain selectable." : "All numbers are spaced evenly and remain selectable."}` : ""
    };
}

function setupNumberLine(input, onInput, excludedNote = null) {
    let selected = Number(input.value);
    let scale;
    input.min = "0";
    input.max = "100000";
    input.step = "1";
    const hint = document.createElement("p");
    hint.className = "hint number-line-hint";
    hint.id = `${input.id}-scale-hint`;
    input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    const setValue = value => {
        selected = value;
        input.value = Math.round(scale.position(value) * 100000);
        input.setAttribute("aria-valuetext", String(value));
        input.setAttribute("aria-valuenow", String(value));
        input.setAttribute("aria-valuemin", "1");
        input.setAttribute("aria-valuemax", String(game.maxNumber));
    };
    const refresh = () => {
        scale = createNumberLineScale(excludedNote);
        setValue(selected);
        hint.textContent = scale.description;
        hint.hidden = !scale.description;
        // Align interior bounds with markers; extend outer bounds to the track edges.
        const start = scale.left === 0 ? "0%" : `calc(${scale.left * 100}% + ${12 - 24 * scale.left}px)`;
        const end = scale.right === 0 ? "100%" : `calc(${(1 - scale.right) * 100}% + ${12 - 24 * (1 - scale.right)}px)`;
        input.style.background = `linear-gradient(to right, var(--line) ${start}, rgb(from var(--accent-theme-color) r g b / 20%) ${start}, rgb(from var(--accent-theme-color) r g b / 30%) ${end}, var(--line) ${end})`;
        if (showNumberlineNotes.value === "none") input.style.background = "var(--line)";
    };
    input.addEventListener("numberline-settings-change", refresh);
    input.addEventListener("input", () => {
        setValue(scale.number(Number(input.value) / 100000));
        onInput(selected);
    });
    input.addEventListener("keydown", event => {
        const changes = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
        let value;
        if (event.key === "Home") value = 1;
        else if (event.key === "End") value = game.maxNumber;
        else if (event.key in changes) value = selected + changes[event.key];
        else return;
        event.preventDefault();
        setValue(Math.max(1, Math.min(game.maxNumber, value)));
        onInput(selected);
    });
    refresh();
    return { setValue, refresh, hint, position: value => scale.position(value) * 100 + "%" };
}

function renderTurn() {
    saveQuestionDraft();
    gameCard.innerHTML = ""; const view = cloneTemplate("turnTemplate");
    view.querySelector(".turn-label").textContent = `${playerName(game.currentPlayer)}'s turn • trying to find ${playerName(opponentOf(game.currentPlayer))}'s number`;
    const tabs = [...view.querySelectorAll(".mode-tab")]; const questionPanel = view.querySelector(".question-panel"); const guessPanel = view.querySelector(".guess-panel");
    view.querySelector(".guess-settings-btn").addEventListener("click", () => numberlineSettingsDialog.showModal());
    tabs.forEach(tab => tab.addEventListener("click", () => { tabs.forEach(item => item.classList.toggle("active", item === tab)); const isQuestion = tab.dataset.mode === "question"; questionPanel.classList.toggle("hidden", !isQuestion); guessPanel.classList.toggle("hidden", isQuestion); if (!isQuestion) guessValue.focus(); }));
    const questionInput = view.querySelector("#questionInput"); const questionError = view.querySelector(".question-error");
    const charCount = view.querySelector(".char-count");
    questionInput.value = game.questionDraft;
    charCount.textContent = `${questionInput.value.length} / 180`;
    questionInput.addEventListener("input", () => {
        game.questionDraft = questionInput.value;
        charCount.textContent = `${questionInput.value.length} / 180`;
        questionError.textContent = "";
    });
    view.querySelector(".question-form").addEventListener("submit", event => {
        event.preventDefault(); const question = questionInput.value.trim();
        if (!question) questionError.textContent = "Enter a question first.";
        else if (containsForbiddenNumber(question)) questionError.textContent = "Questions cannot contain digits or number words. Rephrase it without numbers.";
        else { game.questionDraft = ""; submitAction({ type: "question", question }); }
    });
    const guessInput = view.querySelector("#guessInput"); const guessValue = view.querySelector("#guessValue"); const guessError = view.querySelector(".guess-error"); guessInput.max = game.maxNumber; guessValue.max = game.maxNumber;
    const missedGuesses = incorrectGuesses(localPlayer());
    const guessSubmit = view.querySelector(".guess-form button[type='submit']");
    const markers = view.querySelector(".guess-markers");
    const guessLine = setupNumberLine(guessInput, value => { guessValue.value = value; updateGuessValidity(); });
    guessPanel.querySelector(".guess-slider-row").after(guessLine.hint);
    function updateSelectedNoteMarkers() {
        markers.querySelectorAll("[data-value]").forEach(marker => {
            marker.classList.toggle("is-selected", Number(marker.dataset.value) === Number(guessValue.value));
        });
    }
    const sliderRow = guessPanel.querySelector(".guess-slider-row");
    sliderRow.addEventListener("mousemove", event => {
        if (showNumberlineLabels.value !== "hover") return;
        markers.querySelectorAll("[data-value]").forEach(marker => {
            const label = marker.querySelector(".guess-marker-value");
            const targets = [marker, label].filter(Boolean);
            const hovered = targets.some(target => {
                const bounds = target.getBoundingClientRect();
                const padding = target === marker ? 6 : 0;
                return event.clientX >= bounds.left - padding && event.clientX <= bounds.right + padding
                    && event.clientY >= bounds.top - padding && event.clientY <= bounds.bottom + padding;
            });
            marker.classList.toggle("is-hovered", hovered);
        });
    });
    sliderRow.addEventListener("mouseleave", () => {
        markers.querySelectorAll(".is-hovered").forEach(marker => marker.classList.remove("is-hovered"));
    });
    function updateGuessValidity() {
        updateSelectedNoteMarkers();
        const missed = missedGuesses.has(Number(guessValue.value));
        guessValue.classList.toggle("incorrect-guess", missed);
        guessValue.setAttribute("aria-invalid", String(missed));
        guessInput.setAttribute("aria-invalid", String(missed));
        guessSubmit.disabled = missed;
        guessError.textContent = missed ? "You already guessed this number incorrectly. Choose another number." : "";
        return !missed;
    }
    function layoutMarkerValues() {
        if (!markers.getBoundingClientRect().width) return;
        const labels = [...markers.querySelectorAll(".guess-marker-value")]
            .map(label => ({ label, bounds: label.getBoundingClientRect() }))
            .sort((a, b) => a.bounds.left - b.bounds.left);
        let previousRight = -Infinity;
        let row = 0;
        const rowHeight = Math.max(16, ...labels.map(({ bounds }) => bounds.height)) + 2;
        labels.forEach(({ label, bounds }) => {
            row = bounds.left < previousRight + 12 ? 1 - row : 0;
            previousRight = bounds.right;
            label.style.setProperty("--marker-label-offset", `${14 + rowHeight * row}px`);
        });
    }
    const markerResizeObserver = new ResizeObserver(() => {
        if (!markers.isConnected) {
            markerResizeObserver.disconnect();
            return;
        }
        layoutMarkerValues();
    });
    markerResizeObserver.observe(markers);
    function updateGuessMarkers() {
        markers.innerHTML = "";
        const labelsVisible = showNumberlineLabels.value !== "never";
        markers.classList.toggle("labels-on-hover", showNumberlineLabels.value === "hover");
        markers.removeAttribute("aria-hidden");
        guessLine.refresh();
        const position = guessLine.position;
        missedGuesses.forEach(guess => {
            const marker = document.createElement("span");
            marker.className = "guess-marker";
            marker.dataset.value = guess;
            marker.style.left = position(guess);
            const label = document.createElement("span");
            label.className = "guess-marker-value";
            label.textContent = guess;
            if (labelsVisible && guess !== 1 && guess !== game.maxNumber) marker.appendChild(label);
            markers.appendChild(marker);
        });
        const symbols = { above: "➡", below: "⬅", around: "⬌" };
        const notesByValue = new Map();
        answerNotes.forEach((note, index) => {
            const item = game.history[index];
            if (showNumberlineNotes.value === "none" || !item || item.type !== "question" || item.asker !== localPlayer() || !symbols[note.direction]) return;
            if (!notesByValue.has(note.value)) notesByValue.set(note.value, new Map());
            const directions = notesByValue.get(note.value);
            if (!directions.has(note.direction)) directions.set(note.direction, []);
            directions.get(note.direction).push(index);
        });
        if (showNumberlineNotes.value === "innermost") {
            let innermostAbove = -Infinity, innermostBelow = Infinity;
            notesByValue.forEach((directions, value) => {
                if (directions.has("above")) innermostAbove = Math.max(innermostAbove, value);
                if (directions.has("below")) innermostBelow = Math.min(innermostBelow, value);
            });
            notesByValue.forEach((directions, value) => {
                if (value !== innermostAbove) directions.delete("above");
                if (value !== innermostBelow) directions.delete("below");
                if (!directions.size) notesByValue.delete(value);
            });
        }
        const descriptions = [];
        notesByValue.forEach((directions, value) => {
            const marker = document.createElement("span");
            marker.className = "guess-note-marker";
            marker.dataset.value = value;
            if (directions.size === 1) marker.dataset.direction = directions.keys().next().value;
            marker.style.left = position(value);
            const arrow = document.createElement("span");
            arrow.className = "guess-note-arrow";
            directions.forEach((indices, direction) => {
                const symbol = document.createElement("span");
                symbol.className = "guess-note-symbol";
                symbol.dataset.direction = direction;
                symbol.tabIndex = 0;
                symbol.setAttribute("aria-label", `Note: ${direction} ${value}`);
                symbol.textContent = symbols[direction];
                const popup = document.createElement("span");
                popup.className = "guess-note-popup";
                indices.forEach((index, noteIndex) => {
                    const link = document.createElement("button");
                    link.type = "button";
                    link.className = "ghost-btn";
                    link.textContent = indices.length === 1 ? "Go to note" : `Go to note ${noteIndex + 1}`;
                    link.addEventListener("click", () => {
                        const target = document.getElementById(`answer-note-entry-${index}`);
                        if (!target) return;
                        window.clearTimeout(noteHighlightTimer);
                        document.querySelectorAll(".history-item.note-highlight").forEach(entry => entry.classList.remove("note-highlight"));
                        target.classList.add("note-highlight");
                        noteHighlightTimer = window.setTimeout(() => {
                            target.classList.remove("note-highlight");
                            noteHighlightTimer = null;
                        }, 500);
                        target.querySelector(".answer-notes-button").focus({ preventScroll: true });
                        target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
                    });
                    popup.appendChild(link);
                });
                symbol.appendChild(popup);
                arrow.appendChild(symbol);
            });
            marker.appendChild(arrow);
            if (labelsVisible && value !== 1 && value !== game.maxNumber && !missedGuesses.has(value)) {
                const label = document.createElement("span");
                label.className = "guess-marker-value";
                label.textContent = value;
                marker.appendChild(label);
            }
            markers.appendChild(marker);
            descriptions.push([...directions.keys()].join(" and ") + " " + value);
        });
        [1, game.maxNumber].forEach(value => {
            const marker = document.createElement("span");
            marker.className = "guess-endpoint-marker";
            marker.dataset.value = value;
            marker.style.left = position(value);
            const label = document.createElement("span");
            label.className = "guess-marker-value";
            label.textContent = value;
            marker.appendChild(label);
            markers.appendChild(marker);
        });
        guessInput.setAttribute("aria-description", descriptions.length ? "Notes: " + descriptions.join("; ") + "." : "No notes on the number line.");
        guessPanel.querySelector(".guess-slider-row").classList.toggle("has-note-markers", notesByValue.size > 0);
        guessPanel.querySelector(".guess-slider-row").classList.add("has-marker-values");
        updateSelectedNoteMarkers();
        layoutMarkerValues();
    }
    view.querySelector(".screen").addEventListener("answer-notes-change", updateGuessMarkers);
    view.querySelector(".screen").addEventListener("numberline-settings-change", updateGuessMarkers);
    if (game.winner !== null) {
        view.querySelector(".screen-title").textContent = "Make your final guess";
        view.querySelector(".turn-label").textContent = `${playerName(game.winner)} guessed correctly. You have one final guess to tie!`;
        tabs.find(tab => tab.dataset.mode === "guess").click();
        view.querySelector(".mode-tabs").classList.add("hidden");
        view.querySelector(".guess-panel .hint").textContent = "Guess correctly to tie. A wrong guess ends the game.";
    }
    guessValue.addEventListener("input", () => {
        let value = Number(guessValue.value);
        if (value > game.maxNumber) { value = game.maxNumber; guessValue.value = value; }
        if (Number.isInteger(value) && value >= 1 && value <= game.maxNumber) guessLine.setValue(value);
        updateGuessValidity();
    });
    updateGuessMarkers();
    updateGuessValidity();
    view.querySelector(".guess-form").addEventListener("submit", event => { event.preventDefault(); if (!updateGuessValidity()) return; const guess = Number(guessValue.value); if (!Number.isInteger(guess) || guess < 1 || guess > game.maxNumber) guessError.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; else { guessLine.setValue(guess); submitAction({ type: "guess", guess }); } });
    view.querySelector(".rules-btn").addEventListener("click", () => rulesDialog.showModal()); appendConversation(view); gameCard.appendChild(view); setTimeout(() => (game.winner !== null ? guessValue : questionInput).focus(), 0);
}
function renderAnswer() {
    gameCard.innerHTML = ""; const view = cloneTemplate("answerTemplate"); const pending = game.pendingQuestion;
    view.querySelector(".answer-label").textContent = `${playerName(pending.answerer)} • answer about your secret number`; view.querySelector(".asked-question").textContent = pending.question;
    view.querySelector(".own-secret-number").textContent = game.secrets[localPlayer()] ?? "hidden";
    const input = view.querySelector("#answerInput");
    const answerCharCount = view.querySelector(".answer-char-count");
    view.querySelector(".answer-form").addEventListener("submit", event => { event.preventDefault(); const answer = input.value.trim(); if (!answer) view.querySelector(".answer-error").textContent = "Enter an answer first."; else submitAction({ type: "answer", answer }); });
    input.addEventListener("input", () => answerCharCount.textContent = `${input.value.length} / 220`); appendConversation(view, true); gameCard.appendChild(view); setTimeout(() => input.focus(), 0);
}
function appendConversation(view, includePending = false) {
    const conversation = cloneTemplate("conversationTemplate");
    renderHistoryInto(conversation, includePending);
    view.querySelector(".screen").appendChild(conversation);
}
function renderHistoryInto(view, includePending = false) {
    const list = view.querySelector(".history-list"); view.querySelector(".history-count").textContent = `${game.history.length} turn${game.history.length === 1 ? "" : "s"} recorded`;
    if (!game.history.length && !includePending) { list.innerHTML = `<div class="history-empty">No questions or guesses yet.</div>`; return; }
    if (includePending && game.pendingQuestion) {
        const entry = document.createElement("div"); entry.className = "history-item";
        const isOwnQuestion = game.pendingQuestion.asker === localPlayer();
        entry.classList.toggle("own-question", isOwnQuestion);
        entry.innerHTML = `<div class="history-meta">${isOwnQuestion ? "You" : playerName(game.pendingQuestion.asker)} asked • awaiting answer</div><p></p>`;
        entry.querySelector("p").textContent = `“${game.pendingQuestion.question}”`;
        list.appendChild(entry);
    }
    [...game.history].reverse().forEach((item, reverseIndex) => {
        const entry = document.createElement("div"); entry.className = "history-item";
        if (item.type === "question") {
            const isOwnQuestion = item.asker === localPlayer();
            entry.classList.toggle("own-question", isOwnQuestion);
            entry.innerHTML = `<div class="history-meta">${isOwnQuestion ? "You" : playerName(item.asker)} asked</div><p></p><p class="answer"></p>`;
            entry.querySelector("p").textContent = `“${item.question}”`;
            entry.querySelector(".answer").textContent = `${playerName(item.answerer)}: ${item.answer}`;
            if (isOwnQuestion) {
                entry.classList.add("has-answer-note");
                const historyIndex = game.history.length - 1 - reverseIndex;
                entry.id = `answer-note-entry-${historyIndex}`;
                const note = answerNotes.get(historyIndex) || { value: Math.ceil(game.maxNumber / 2), direction: null, expanded: false };
                const directions = [
                    { value: "above", symbol: "⬆", label: "Above" },
                    { value: "below", symbol: "⬇", label: "Below" },
                    { value: "around", symbol: "⬌", label: "Around" }
                ];
                const button = document.createElement("button");
                button.type = "button";
                button.className = "ghost-btn answer-notes-button";
                button.textContent = "Make a Note";
                const panel = document.createElement("div");
                panel.className = "answer-notes";
                panel.id = `answer-notes-${historyIndex}`;
                panel.hidden = !note.expanded;
                button.setAttribute("aria-controls", panel.id);
                button.setAttribute("aria-expanded", String(note.expanded));
                const label = document.createElement("label");
                label.htmlFor = `answer-note-input-${historyIndex}`;
                label.textContent = "Opponent's number compared with: ";
                const output = document.createElement("output");
                output.htmlFor = label.htmlFor;
                label.appendChild(output);
                const input = document.createElement("input");
                input.id = label.htmlFor;
                input.type = "range";
                input.className = "guess-slider answer-note-slider";
                input.min = "1";
                input.max = String(game.maxNumber);
                input.step = "1";
                input.value = note.value;
                const choices = document.createElement("div");
                choices.className = "answer-note-choices";
                const updateNote = () => {
                    output.value = String(note.value);
                    const selected = directions.find(direction => direction.value === note.direction);
                    button.textContent = selected ? `${note.value} ${selected.symbol}` : "Make a Note";
                    button.dataset.direction = note.direction || "";
                    button.setAttribute("aria-label", selected ? `Edit note: opponent's number is ${selected.value} ${note.value}` : "Make a Note");
                    choices.querySelectorAll("button").forEach(choice => {
                        choice.setAttribute("aria-pressed", String(choice.dataset.direction === note.direction));
                    });
                    entry.dispatchEvent(new Event("answer-notes-change", { bubbles: true }));
                };
                const noteLine = setupNumberLine(input, value => {
                    note.value = value;
                    answerNotes.set(historyIndex, note);
                    updateNote();
                }, historyIndex);
                list.addEventListener("answer-notes-change", noteLine.refresh);
                directions.forEach(direction => {
                    const choice = document.createElement("button");
                    choice.type = "button";
                    choice.className = "ghost-btn answer-note-choice";
                    choice.dataset.direction = direction.value;
                    choice.textContent = `${direction.symbol} ${direction.label}`;
                    choice.addEventListener("click", () => {
                        note.direction = direction.value;
                        note.expanded = false;
                        answerNotes.set(historyIndex, note);
                        updateNote();
                        panel.hidden = true;
                        button.setAttribute("aria-expanded", "false");
                        button.focus();
                    });
                    choices.appendChild(choice);
                });
                button.addEventListener("click", () => {
                    note.expanded = !note.expanded;
                    answerNotes.set(historyIndex, note);
                    panel.hidden = !note.expanded;
                    button.setAttribute("aria-expanded", String(note.expanded));
                    if (note.expanded) input.focus();
                });
                updateNote();
                panel.append(label, input, noteLine.hint, choices);
                entry.append(button, panel);
            }
        }
        else {
            const isOwnGuess = item.player === localPlayer();
            entry.classList.toggle("own-guess", isOwnGuess);
            entry.innerHTML = `<div class="history-meta">${isOwnGuess ? "You" : playerName(item.player)} guessed</div><p></p>`;
            entry.querySelector("p").textContent = `${item.guess} — ${item.correct ? "correct" : "incorrect"}`;
        }
        list.appendChild(entry);
    });
}
function renderWinner(winner, winningGuess) {
    gameCard.innerHTML = ""; const view = cloneTemplate("resultTemplate");
    view.querySelector(".winner-title").textContent = winner === null ? "It's a tie!" : `${playerName(winner)} wins!`;
    view.querySelector(".winner-copy").textContent = winner === null ? "Both players guessed the opponent's secret number correctly." : `${winningGuess} was the correct guess. The final guess did not tie the game.`;
    view.querySelector(".reveal-box").textContent = `Final numbers\n${playerName(0)} chose ${game.secrets[0] ?? "hidden"}\n${playerName(1)} chose ${game.secrets[1] ?? "hidden"}`;
    view.querySelector(".play-again-btn").addEventListener("click", startRematch);
    view.querySelector(".exit-lobby-btn").addEventListener("click", resetGame);
    gameCard.appendChild(view);
}
function resetForRematch() {
    answerNotes.clear();
    const opponentName = game.names[1];
    game.secrets = [null, null]; game.names = [game.nickname, opponentName]; game.currentPlayer = 0;
    game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null;
    game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null;
    send({ type: "rematch" }); renderLobby("host");
}
function resetGuestForRematch() {
    answerNotes.clear();
    game.secrets = [null, null]; game.names[1] = game.nickname; game.currentPlayer = 0;
    game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null;
    game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null;
    renderLobby("connected"); send({ type: "join", name: game.nickname });
}
function startRematch() {
    if (game.role === "host") resetForRematch();
    else { send({ type: "rematch-request" }); renderWaiting("Rematch requested", "Waiting for the host to open a new game."); }
}
function resetGame() {
    answerNotes.clear();
    disconnectNetwork();
    game.role = null; game.nickname = ""; game.secrets = [null, null]; game.names = [null, null]; game.currentPlayer = 0; game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null; game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null; renderStart();
}
document.querySelector(".close-dialog").addEventListener("click", () => rulesDialog.close());
document.querySelector(".close-settings-dialog").addEventListener("click", () => numberlineSettingsDialog.close());
function refreshNumberlineSettings() {
    numberlineCompression.disabled = showNumberlineNotes.value === "none";
    gameCard.querySelectorAll(".guess-slider, .screen").forEach(element => {
        element.dispatchEvent(new Event("numberline-settings-change"));
    });
}
numberlineSettingsDialog.addEventListener("change", refreshNumberlineSettings);
numberlineSettingsDialog.querySelector(".reset-numberline-settings").addEventListener("click", () => {
    showNumberlineNotes.value = "innermost";
    showNumberlineLabels.value = "always";
    numberlineSettingsDialog.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = input.defaultChecked;
    });
    refreshNumberlineSettings();
});
numberlineSettingsDialog.addEventListener("click", event => {
    if (event.target !== numberlineSettingsDialog) return;
    const bounds = numberlineSettingsDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) numberlineSettingsDialog.close();
});
rulesDialog.addEventListener("click", event => { if (event.target === rulesDialog) rulesDialog.close(); });
if (handoffCloseButton) {
    handoffCloseButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!handoffDialogManualCloseAllowed) {
            if (handoffDialog.open) handoffDialog.showModal();
            return;
        }
        handoffDialog.close();
    });
}
handoffDialog.addEventListener("click", event => {
    if (event.target === handoffDialog) {
        event.preventDefault();
        if (!handoffDialogManualCloseAllowed) {
            if (handoffDialog.open) handoffDialog.showModal();
            return;
        }
        handoffDialog.close();
    }
});
handoffDialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (!handoffDialogManualCloseAllowed) {
        if (handoffDialog.open) handoffDialog.showModal();
        return;
    }
    handoffDialog.close();
});
renderStart();
