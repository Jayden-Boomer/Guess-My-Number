const DEFAULT_MAX_NUMBER = 50;
const MAX_ENDPOINT = 1000;
const MAX_NICKNAME_LENGTH = 24;
const NICKNAME_COOKIE = "hidden-number-duel-nickname";
const NICKNAME_COOKIE_MAX_AGE = 315360000;
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
const handoffDialog = document.getElementById("handoffDialog");
const numberWords = new Set([
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "first", "second",
    "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "half",
    "quarter", "double", "triple"
]);

function cloneTemplate(id) { return document.getElementById(id).content.cloneNode(true); }
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
function setNicknameCookie(nickname) {
    if (nickname) document.cookie = `${NICKNAME_COOKIE}=${encodeURIComponent(nickname)}; Max-Age=${NICKNAME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}
function getNicknameCookie() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith(`${NICKNAME_COOKIE}=`));
    if (!cookie) return "";
    try {
        return decodeURIComponent(cookie.slice(NICKNAME_COOKIE.length + 1)).slice(0, MAX_NICKNAME_LENGTH);
    } catch { return ""; }
}
function showHandoffDialog(copy) {
    handoffDialog.querySelector(".handoff-copy").textContent = copy;
    if (!handoffDialog.open) handoffDialog.showModal();
}
function renderStart() {
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = `<div class="screen">
        <div class="step-badge">Start a duel</div>
        <h2 class="screen-title">Enter the arena</h2>
        <p class="screen-copy">Choose a nickname, then host a new lobby or join a duel already waiting for you.</p>
        <form class="secret-form start-form">
            <label for="startNickname">Your nickname</label>
            <input id="startNickname" type="text" maxlength="${MAX_NICKNAME_LENGTH}" autocomplete="nickname" required />
            <span class="lobby-mode-label">Lobby mode</span>
            <div class="lobby-mode-buttons" role="group" aria-label="Lobby mode">
                <button type="button" class="lobby-mode-btn active" data-mode="host" aria-pressed="true">Host lobby</button>
                <button type="button" class="lobby-mode-btn" data-mode="join" aria-pressed="false">Join lobby</button>
            </div>
            <div class="join-code-field hidden"><label for="hostCode">Host lobby code</label><input id="hostCode" type="text" maxlength="64" autocomplete="off" placeholder="Paste the host code" /></div>
            <p class="error" role="alert"></p><button type="submit" class="primary-btn wide-btn">Continue</button>
        </form>
    </div>`;
    const form = gameCard.querySelector(".start-form");
    const modeButtons = [...gameCard.querySelectorAll(".lobby-mode-btn")];
    const joinField = gameCard.querySelector(".join-code-field");
    const nickname = gameCard.querySelector("#startNickname");
    const error = gameCard.querySelector(".error");
    nickname.value = getNicknameCookie();
    const savedLobby = getLobbyCookie();
    if (savedLobby) {
        const rejoinSeparator = document.createElement("div");
        rejoinSeparator.className = "rejoin-separator";
        rejoinSeparator.textContent = "or";
        const rejoinButton = document.createElement("button");
        rejoinButton.type = "button";
        rejoinButton.className = "ghost-btn wide-btn rejoin-btn";
        rejoinButton.textContent = `Rejoin ${savedLobby.rejoinName || savedLobby.nickname}'s lobby`;
        joinField.after(rejoinSeparator, rejoinButton);
        rejoinButton.addEventListener("click", () => {
            nickname.value = savedLobby.nickname;
            game.nickname = savedLobby.nickname;
            modeButtons.find(button => button.dataset.mode === "join").click();
            gameCard.querySelector("#hostCode").value = savedLobby.lobbyCode;
            startJoining(savedLobby.lobbyCode, error);
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
    if (game.phase === "setup") return renderSecretSetup();
    if (game.phase === "finished") return renderWinner(game.winner, game.winningGuess);
    if (game.pendingQuestion) {
        if (game.pendingQuestion.answerer === localPlayer()) renderAnswer();
        else renderWaiting("Question sent", `Waiting for ${playerName(game.pendingQuestion.answerer)} to answer.`);
        return;
    }
    if (game.currentPlayer === localPlayer()) renderTurn();
    else {
        const latestAnswer = [...game.history].reverse().find(item => item.type === "question");
        if (latestAnswer && latestAnswer.answerer === game.currentPlayer) {
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
    if (action.type === "question") game.pendingQuestion = { asker: player, answerer: opponentOf(player), question: action.question };
    else if (action.type === "answer" && game.pendingQuestion && game.pendingQuestion.answerer === player) {
        game.history.push({ type: "question", ...game.pendingQuestion, answer: action.answer }); game.currentPlayer = player; game.pendingQuestion = null;
    } else if (action.type === "guess") {
        const correct = action.guess === game.secrets[opponentOf(player)];
        game.history.push({ type: "guess", player, guess: action.guess, correct });
        if (correct) { game.phase = "finished"; game.winner = player; game.winningGuess = action.guess; } else game.currentPlayer = opponentOf(player);
    } else return;
    broadcastState(); renderNetworkState();
}

function renderTurn() {
    saveQuestionDraft();
    gameCard.innerHTML = ""; const view = cloneTemplate("turnTemplate");
    view.querySelector(".turn-label").textContent = `${playerName(game.currentPlayer)}'s turn • trying to find ${playerName(opponentOf(game.currentPlayer))}'s number`;
    const tabs = [...view.querySelectorAll(".mode-tab")]; const questionPanel = view.querySelector(".question-panel"); const guessPanel = view.querySelector(".guess-panel");
    tabs.forEach(tab => tab.addEventListener("click", () => { tabs.forEach(item => item.classList.toggle("active", item === tab)); const isQuestion = tab.dataset.mode === "question"; questionPanel.classList.toggle("hidden", !isQuestion); guessPanel.classList.toggle("hidden", isQuestion); }));
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
    guessInput.addEventListener("input", () => { guessValue.value = guessInput.value; });
    guessValue.addEventListener("input", () => {
        let value = Number(guessValue.value);
        if (value > game.maxNumber) { value = game.maxNumber; guessValue.value = value; }
        if (Number.isInteger(value) && value >= 1 && value <= game.maxNumber) guessInput.value = value;
    });
    view.querySelector(".guess-form").addEventListener("submit", event => { event.preventDefault(); const guess = Number(guessValue.value); if (!Number.isInteger(guess) || guess < 1 || guess > game.maxNumber) guessError.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; else { guessInput.value = guess; submitAction({ type: "guess", guess }); } });
    view.querySelector(".rules-btn").addEventListener("click", () => rulesDialog.showModal()); appendConversation(view); gameCard.appendChild(view); setTimeout(() => questionInput.focus(), 0);
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
        entry.innerHTML = `<div class="history-meta">${playerName(game.pendingQuestion.asker)} asked • awaiting answer</div><p></p>`;
        entry.querySelector("p").textContent = `“${game.pendingQuestion.question}”`;
        list.appendChild(entry);
    }
    [...game.history].reverse().forEach(item => {
        const entry = document.createElement("div"); entry.className = "history-item";
        if (item.type === "question") { entry.innerHTML = `<div class="history-meta">${playerName(item.asker)} asked</div><p></p><p class="answer"></p>`; entry.querySelector("p").textContent = `“${item.question}”`; entry.querySelector(".answer").textContent = `${playerName(item.answerer)}: ${item.answer}`; }
        else { entry.innerHTML = `<div class="history-meta">${playerName(item.player)} guessed</div><p></p>`; entry.querySelector("p").textContent = `${item.guess} — ${item.correct ? "correct" : "incorrect"}`; }
        list.appendChild(entry);
    });
}
function renderWinner(winner, winningGuess) {
    gameCard.innerHTML = ""; const view = cloneTemplate("resultTemplate");
    view.querySelector(".winner-title").textContent = `${playerName(winner)} wins!`; view.querySelector(".winner-copy").textContent = `${winningGuess} was the correct guess.`;
    view.querySelector(".reveal-box").textContent = `Final numbers\n${playerName(0)} chose ${game.secrets[0] ?? "hidden"}\n${playerName(1)} chose ${game.secrets[1] ?? "hidden"}`;
    view.querySelector(".play-again-btn").addEventListener("click", startRematch);
    view.querySelector(".exit-lobby-btn").addEventListener("click", resetGame);
    gameCard.appendChild(view);
}
function resetForRematch() {
    const opponentName = game.names[1];
    game.secrets = [null, null]; game.names = [game.nickname, opponentName]; game.currentPlayer = 0;
    game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null;
    game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null;
    send({ type: "rematch" }); renderLobby("host");
}
function resetGuestForRematch() {
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
    disconnectNetwork();
    game.role = null; game.nickname = ""; game.secrets = [null, null]; game.names = [null, null]; game.currentPlayer = 0; game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null; game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null; renderStart();
}
document.querySelector(".close-dialog").addEventListener("click", () => rulesDialog.close());
rulesDialog.addEventListener("click", event => { if (event.target === rulesDialog) rulesDialog.close(); });
document.querySelector(".close-handoff-dialog").addEventListener("click", () => handoffDialog.close());
handoffDialog.addEventListener("click", event => { if (event.target === handoffDialog) handoffDialog.close(); });
renderStart();
