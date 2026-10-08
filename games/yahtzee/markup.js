// The game's controls, drawn into <div id="yahtzee"> by app.js. Kept here, not
// in the page, so any page can host the game with one empty element: the
// standalone index.html and the Scale-to-Zero Report's page both do.
// Static markup only; nothing a player typed ever goes through this.

export const MARKUP = `
<form id="yz-setup" class="yz-setup" autocomplete="off">
  <label for="yz-name" class="yz-label">Your name</label>
  <div class="yz-row">
    <input id="yz-name" name="name" type="text" maxlength="24" spellcheck="false" required>
    <button id="yz-go" type="submit">Start a game</button>
  </div>
  <p id="yz-setup-note" class="yz-hint"></p>
</form>

<section id="yz-table" class="yz-table" hidden>
  <div class="yz-bar">
    <div class="yz-invite">
      <label for="yz-link" class="yz-label">Invite link</label>
      <div class="yz-row">
        <input id="yz-link" type="text" readonly spellcheck="false">
        <button id="yz-copy" type="button">Copy link</button>
      </div>
    </div>
    <form id="yz-rename" class="yz-rename" autocomplete="off">
      <label for="yz-me" class="yz-label">Playing as</label>
      <div class="yz-row">
        <input id="yz-me" type="text" maxlength="24" spellcheck="false">
        <button type="submit" class="yz-btn-quiet">Rename</button>
      </div>
    </form>
  </div>
  <p id="yz-status" class="yz-status" aria-live="polite"></p>
  <p id="yz-error" class="yz-error" role="alert" hidden></p>

  <div class="yz-grid">
    <div class="yz-play">
      <p id="yz-turn" class="yz-turn" aria-live="polite"></p>
      <div id="yz-dice" class="yz-dice" role="group" aria-label="Dice. Tap a die to hold it."></div>
      <div class="yz-actions">
        <button id="yz-roll" type="button">Roll</button>
        <p id="yz-play-for" class="yz-hint" hidden></p>
      </div>
      <div id="yz-host" class="yz-host" hidden></div>
      <div class="yz-card-wrap"><table id="yz-card" class="yz-card"></table></div>
      <ol id="yz-log" class="yz-log" aria-label="What happened"></ol>
    </div>

    <aside class="yz-side">
      <div class="yz-video-head">
        <h2>Table</h2>
        <button id="yz-cam" type="button" class="yz-btn-quiet">Turn on camera</button>
      </div>
      <div id="yz-video" class="yz-video"></div>
      <ol id="yz-chat-list" class="yz-chat-list" aria-label="Chat" aria-live="polite"></ol>
      <form id="yz-chat-form" class="yz-chat-form" autocomplete="off">
        <label class="yz-photo-btn" title="Send a photo or GIF (up to 5 MB)">
          <input id="yz-photo" type="file">
          <span aria-hidden="true">+</span><span class="yz-sr">Send a photo or GIF</span>
        </label>
        <input id="yz-chat-input" type="text" maxlength="500" placeholder="Say something" aria-label="Chat message">
        <button type="submit">Send</button>
      </form>
    </aside>
  </div>
</section>
`;
