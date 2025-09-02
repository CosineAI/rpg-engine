(() => {
  const State = {
    CUTSCENE: 'CUTSCENE',
    OVERWORLD: 'OVERWORLD',
    COMBAT: 'COMBAT',
  };

  class Game {
    constructor(root) {
      this.root = root;

      // World
      this.tileSize = 28; // px per tile
      this.mapWidth = Math.ceil(window.innerWidth / this.tileSize);
      this.mapHeight = Math.ceil(window.innerHeight / this.tileSize);
      this.tiles = []; // 'water' | 'land'
      this.player = { x: 0, y: 0 };
      // Player stats
      this.stats = {
        maxHp: 25,
        atk: 5,
        def: 2,
        spe: 8,
        luc: 10,
        xp: 0,
        gold: 0,
      };
      this.hp = this.stats.maxHp;

      // Enemy (created on combat start)
      this.enemy = null;

      // Encounter
      this.encounterRange = { min: 5, max: 10 };
      this.encounterSteps = 0;

      // Cutscene
      this.cutsceneLines = [
        "Long ago, in a land of emerald isles and sapphire seas...",
        "A lone adventurer washed ashore, with only a will to explore.",
        "Legends speak of a sleeping colossus beneath the waves.",
        "Your journey begins here."
      ];
      this.cutIndex = 0;

      // Combat
      this.choiceIndex = 0; // 0=Attack, 1=Run
      this.combatMessage = '';
      this.awaitContinue = null; // if set, wait for key press to exit combat

      // State
      this.current = State.CUTSCENE;

      // DOM
      this.$ = {};
      this.buildUI();

      // Input
      this.bindInputs();

      // Build world and start
      this.generateWorld();
      this.placePlayerOnLand();
      this.resetEncounterCounter();
      this.render();

      // Keep world static; do not regenerate or resize on window changes
      // window.addEventListener('resize', () => this.resizeToViewport());

      // Expose for dev console
      window.__GAME__ = this;
    }

    // ---------- UI ----------
    buildUI() {
      this.root.innerHTML = `
        <div id="map"></div>

        <div id="dialogue">
          <div class="dialogue-box">
            <div class="dialogue-text"></div>
            <div class="dialogue-hint">Space/Click to continue</div>
          </div>
        </div>

        <div id="combat" class="hidden">
          <div id="statusbar">
            <span class="label">Status</span>
            <span>HP: <strong id="hp-val">25/25</strong></span>
            <span>EXP: <strong id="exp-val">0</strong></span>
            <span>Gold: <strong id="gold-val">0</strong></span>
          </div>
          <div class="combat-display">
            <div class="monster" aria-label="Blue monster placeholder"></div>
            <div class="combat-message"></div>
          </div>
          <div class="choices">
            <div class="choice" data-idx="0">Attack</div>
            <div class="choice" data-idx="1">Run</div>
          </div>
        </div>

        <div class="hint">Press \` to toggle Dev Console</div>
        <div id="dev-toggle">\`</div>
        <div id="dev-console" class="hidden"></div>
      `;

      this.$.map = this.root.querySelector('#map');
      this.$.dialogue = this.root.querySelector('#dialogue');
      this.$.dialogueText = this.root.querySelector('.dialogue-text');
      this.$.combat = this.root.querySelector('#combat');
      this.$.hp = this.root.querySelector('#hp-val');
      this.$.exp = this.root.querySelector('#exp-val');
      this.$.gold = this.root.querySelector('#gold-val');
      this.$.combatMsg = this.root.querySelector('.combat-message');
      this.$.choices = Array.from(this.root.querySelectorAll('.choice'));
      this.$.devToggle = this.root.querySelector('#dev-toggle');
      this.$.devPanel = this.root.querySelector('#dev-console');

      this.$.dialogue.addEventListener('click', () => {
        if (this.current === State.CUTSCENE) this.advanceCutscene();
      });

      this.$.choices.forEach(el => {
        el.addEventListener('click', () => {
          if (this.current !== State.COMBAT || this.awaitContinue) return;
          const idx = Number(el.dataset.idx);
          this.choiceIndex = idx;
          this.confirmChoice();
        });
      });

      // Allow clicking the combat area to continue after battle
      this.$.combat.addEventListener('click', () => {
        if (this.current === State.COMBAT && this.awaitContinue) {
          this.resolvePostCombat();
        }
      });

      this.buildDevConsole();
    }

    buildDevConsole() {
      const panel = this.$.devPanel;
      panel.classList.add('dev-console');
      panel.innerHTML = `
        <div class="dev-title">Developer Console</div>
        <div class="section dev-grid">
          <div class="dev-row">
            <label>State</label>
            <select id="dev-state">
              <option value="${State.CUTSCENE}">Cutscene</option>
              <option value="${State.OVERWORLD}">Overworld</option>
              <option value="${State.COMBAT}">Combat</option>
            </select>
          </div>
          <div class="dev-row-3">
            <div>
              <label>HP</label>
              <input id="dev-hp" type="number" min="0" max="999" class="input"/>
            </div>
            <div>
              <label>Player X</label>
              <input id="dev-x" type="number" min="0" class="input"/>
            </div>
            <div>
              <label>Player Y</label>
              <input id="dev-y" type="number" min="0" class="input"/>
            </div>
          </div>
          <div class="dev-row-3">
            <div>
              <label>Steps To Encounter</label>
              <input id="dev-enc" type="number" min="0" class="input"/>
            </div>
            <div>
              <label>Enc Min</label>
              <input id="dev-enc-min" type="number" min="1" class="input"/>
            </div>
            <div>
              <label>Enc Max</label>
              <input id="dev-enc-max" type="number" min="1" class="input"/>
            </div>
          </div>
          <div class="dev-row">
            <button id="dev-apply" class="primary">Apply</button>
            <button id="dev-randomize">Randomize Encounter</button>
          </div>
        </div>

        <div class="section dev-grid">
          <div class="dev-row">
            <button id="dev-to-cutscene">Go Cutscene</button>
            <button id="dev-to-overworld">Go Overworld</button>
          </div>
          <div class="dev-row">
            <button id="dev-to-combat">Start Combat</button>
            <button id="dev-win" class="primary">Force Win</button>
          </div>
          <div class="dev-row">
            <button id="dev-run">Force Run</button>
            <button id="dev-restart" class="warn">Restart Demo</button>
          </div>
        </div>

        <div class="section">
          <small>Tip: Press the grave/backtick key (\`) to toggle this console.</small>
        </div>
      `;

      const $ = (id) => panel.querySelector(id);
      this.$dev = {
        state: $('#dev-state'),
        hp: $('#dev-hp'),
        x: $('#dev-x'),
        y: $('#dev-y'),
        enc: $('#dev-enc'),
        encMin: $('#dev-enc-min'),
        encMax: $('#dev-enc-max'),
        apply: $('#dev-apply'),
        randomize: $('#dev-randomize'),
        toCut: $('#dev-to-cutscene'),
        toOver: $('#dev-to-overworld'),
        toCombat: $('#dev-to-combat'),
        win: $('#dev-win'),
        run: $('#dev-run'),
        restart: $('#dev-restart'),
      };

      // Populate initial values
      this.syncDevConsole();

      this.$dev.apply.addEventListener('click', () => {
        this.hp = clamp(int(this.$dev.hp.value, this.hp), 0, 999);
        const nx = clamp(int(this.$dev.x.value, this.player.x), 0, this.mapWidth - 1);
        const ny = clamp(int(this.$dev.y.value, this.player.y), 0, this.mapHeight - 1);
        if (this.inBounds(nx, ny)) {
          this.player.x = nx;
          this.player.y = ny;
        }
        const emin = Math.max(1, int(this.$dev.encMin.value, this.encounterRange.min));
        const emax = Math.max(emin, int(this.$dev.encMax.value, this.encounterRange.max));
        this.encounterRange = { min: emin, max: emax };
        this.encounterSteps = Math.max(0, int(this.$dev.enc.value, this.encounterSteps));

        const st = this.$dev.state.value;
        if (st !== this.current) {
          if (st === State.CUTSCENE) this.startCutscene();
          if (st === State.OVERWORLD) this.startOverworld();
          if (st === State.COMBAT) this.startCombat();
        }
        this.render();
        this.syncDevConsole();
      });

      this.$dev.randomize.addEventListener('click', () => {
        this.resetEncounterCounter();
        this.syncDevConsole();
      });

      this.$dev.toCut.addEventListener('click', () => this.startCutscene());
      this.$dev.toOver.addEventListener('click', () => this.startOverworld());
      this.$dev.toCombat.addEventListener('click', () => this.startCombat());
      this.$dev.win.addEventListener('click', () => this.finishCombat('win'));
      this.$dev.run.addEventListener('click', () => this.finishCombat('run'));
      this.$dev.restart.addEventListener('click', () => this.restartDemo());

      this.$.devToggle.addEventListener('click', () => this.toggleDev());
    }

    toggleDev(force) {
      const show = typeof force === 'boolean' ? force : this.$.devPanel.classList.contains('hidden');
      this.$.devPanel.classList.toggle('hidden', !show);
    }

    syncDevConsole() {
      if (!this.$dev) return;
      this.$dev.state.value = this.current;
      this.$dev.hp.value = this.hp;
      this.$dev.x.value = this.player.x;
      this.$dev.y.value = this.player.y;
      this.$dev.enc.value = this.encounterSteps;
      this.$dev.encMin.value = this.encounterRange.min;
      this.$dev.encMax.value = this.encounterRange.max;
    }

    // ---------- WORLD ----------
    generateWorld() {
      this.tiles = [];
      const cx = (this.mapWidth - 1) / 2;
      const cy = (this.mapHeight - 1) / 2;
      const rx = this.mapWidth * 0.32;
      const ry = this.mapHeight * 0.32;

      for (let y = 0; y < this.mapHeight; y++) {
        const row = [];
        for (let x = 0; x < this.mapWidth; x++) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          const d = dx * dx + dy * dy;
          // base island shape: ellipse threshold ~1 with a bit of jitter
          const jitter = (noise2d(x * 13.37, y * 7.17) - 0.5) * 0.18;
          const island = d + jitter < 1 ? 'land' : 'water';
          row.push(island);
        }
        this.tiles.push(row);
      }
      // smooth edges: ensure a border of water
      for (let x = 0; x < this.mapWidth; x++) {
        this.tiles[0][x] = 'water';
        this.tiles[this.mapHeight - 1][x] = 'water';
      }
      for (let y = 0; y < this.mapHeight; y++) {
        this.tiles[y][0] = 'water';
        this.tiles[y][this.mapWidth - 1] = 'water';
      }

      // place a single goal tile (yellow) on land, preferably near the edge
      let placed = false;
      for (let attempts = 0; attempts < 200 && !placed; attempts++) {
        const x = randInt(1, this.mapWidth - 2);
        const y = randInt(1, this.mapHeight - 2);
        if (this.tiles[y][x] === 'land') {
          // favor tiles farther from center
          const dx = x - cx;
          const dy = y - cy;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > (this.mapWidth * this.mapWidth + this.mapHeight * this.mapHeight) * 0.05) {
            this.tiles[y][x] = 'goal';
            this.goal = { x, y };
            placed = true;
          }
        }
      }
      if (!placed) {
        // fallback: scan for any land tile
        outer: for (let y = 1; y < this.mapHeight - 1; y++) {
          for (let x = 1; x < this.mapWidth - 1; x++) {
            if (this.tiles[y][x] === 'land') {
              this.tiles[y][x] = 'goal';
              this.goal = { x, y };
              placed = true;
              break outer;
            }
          }
        }
      }
    }

    placePlayerOnLand() {
      // find a land tile near center
      let cx = Math.floor(this.mapWidth / 2);
      let cy = Math.floor(this.mapHeight / 2);
      if (this.tiles[cy][cx] === 'land') {
        this.player.x = cx;
        this.player.y = cy;
        return;
      }
      // spiral search
      let r = 1;
      while (r < Math.max(this.mapWidth, this.mapHeight)) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (this.inBounds(x, y) && this.tiles[y][x] === 'land') {
              this.player.x = x;
              this.player.y = y;
              return;
            }
          }
        }
        r++;
      }
      // fallback
      this.player.x = 1;
      this.player.y = 1;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.mapWidth && y < this.mapHeight;
    }

    isWalkable(x, y) {
      if (!this.inBounds(x, y)) return false;
      const t = this.tiles[y][x];
      return t !== 'water';
    }

    isGoal(x, y) {
      return this.inBounds(x, y) && this.tiles[y][x] === 'goal';
    }

    resetEncounterCounter() {
      const { min, max } = this.encounterRange;
      this.encounterSteps = randInt(min, max);
    }

    resizeToViewport() {
      const cols = Math.ceil(window.innerWidth / this.tileSize);
      const rows = Math.ceil(window.innerHeight / this.tileSize);
      if (cols === this.mapWidth && rows === this.mapHeight) return;

      this.mapWidth = cols;
      this.mapHeight = rows;

      this.generateWorld();
      // Keep player in-bounds and on land if possible
      if (!this.inBounds(this.player.x, this.player.y) || this.tiles[this.player.y][this.player.x] !== 'land') {
        this.placePlayerOnLand();
      }
      this.render();
      this.syncDevConsole();
    }

    // ---------- INPUT ----------
    bindInputs() {
      const isConfirmKey = (e) => {
        return e.key === 'Enter' || e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar' || e.code === 'Space';
      };

      window.addEventListener('keydown', (e) => {
        // Toggle dev console with `
        if (e.key === '`') {
          this.toggleDev();
          e.preventDefault();
          return;
        }

        if (this.current === State.CUTSCENE) {
          if (isConfirmKey(e)) {
            this.advanceCutscene();
            e.preventDefault();
          }
          return;
        }

        if (this.current === State.OVERWORLD) {
          const dir = keyToDir(e.key);
          if (dir) {
            const nx = this.player.x + dir.x;
            const ny = this.player.y + dir.y;
            if (this.isWalkable(nx, ny)) {
              this.player.x = nx;
              this.player.y = ny;

              // If player stepped on goal, end demo
              if (this.isGoal(this.player.x, this.player.y)) {
                this.render();
                this.syncDevConsole();
                this.endDemo();
                e.preventDefault();
                return;
              }

              // Random encounter countdown
              this.encounterSteps = Math.max(0, this.encounterSteps - 1);
              if (this.encounterSteps === 0) {
                this.startCombat();
              }
              this.render();
              this.syncDevConsole();
            }
            e.preventDefault();
          }
          return;
        }

        if (this.current === State.COMBAT) {
          // If waiting for user to acknowledge end-of-battle, only proceed on Space/Enter
          if (this.awaitContinue) {
            if (isConfirmKey(e)) {
              this.resolvePostCombat();
              e.preventDefault();
            }
            return;
          }

          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            this.choiceIndex = this.choiceIndex === 0 ? 1 : 0;
            this.renderChoices();
            e.preventDefault();
          }
          if (isConfirmKey(e)) {
            this.confirmChoice();
            e.preventDefault();
          }
          return;
        }
      });
    }

    // ---------- STATE FLOW ----------
    startCutscene() {
      this.current = State.CUTSCENE;
      this.cutIndex = 0;
      this.render();
      this.syncDevConsole();
    }

    advanceCutscene() {
      this.cutIndex++;
      if (this.cutIndex >= this.cutsceneLines.length) {
        this.startOverworld();
      } else {
        this.render();
      }
    }

    startOverworld() {
      this.current = State.OVERWORLD;
      this.combatMessage = '';
      this.resetEncounterCounter();
      this.render();
      this.syncDevConsole();
    }

    startCombat() {
      this.current = State.COMBAT;
      this.choiceIndex = 0;
      this.awaitContinue = null;
      // Initialize a fresh enemy each encounter
      this.enemy = {
        name: 'Enemy',
        maxHp: 12,
        hp: 12,
        atk: 3,
        def: 3,
        spe: 5,
        luc: 3,
      };
      this.combatMessage = 'A foe approaches!';
      this.render();
      this.syncDevConsole();
    }

    confirmChoice() {
      if (this.choiceIndex === 0) {
        this.runCombatRound();
      } else {
        this.finishCombat('run');
      }
    }

    runCombatRound() {
      if (!this.enemy) return;
      const lines = [];
      lines.push('-> Turn decision');

      const order = this.stats.spe >= this.enemy.spe ? ['player', 'enemy'] : ['enemy', 'player'];

      const attackOnce = (attacker) => {
        const isPlayer = attacker === 'player';
        const A = isPlayer ? { name: 'Player', atk: this.stats.atk, def: this.stats.def, spe: this.stats.spe, luc: this.stats.luc } :
                             { name: 'Enemy', atk: this.enemy.atk, def: this.enemy.def, spe: this.enemy.spe, luc: this.enemy.luc };
        const D = isPlayer ? { name: 'Enemy', atk: this.enemy.atk, def: this.enemy.def, spe: this.enemy.spe, luc: this.enemy.luc } :
                             { name: 'Player', atk: this.stats.atk, def: this.stats.def, spe: this.stats.spe, luc: this.stats.luc };

        // Hit check: 100% - target luck%
        const hitChance = Math.max(0, 100 - D.luc);
        const hitRoll = Math.random() * 100;
        if (hitRoll >= hitChance) {
          lines.push(`${A.name} attacks! ${A.name} missed! ${A.name} deals 0 hp damage.`);
          return false; // no KO
        }

        // Crit check: speed/2 %
        const crit = (Math.random() * 100) < (A.spe / 2);
        const mult = crit ? 3 : 1; // crit multiplier 3x to match example
        const dmg = Math.max(1, A.atk * mult - D.def);

        if (isPlayer) {
          this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
        } else {
          this.hp = Math.max(0, this.hp - dmg);
        }

        const critText = crit ? 'CRITICAL DAMAGE! ' : '';
        lines.push(`${A.name} attacks! ${critText}${A.name} deals ${dmg} hp damage.`);

        // KO check
        if (this.enemy && this.enemy.hp <= 0) {
          lines.push('Enemy defeated! +10 EXP and +10 Gold.');
          this.combatMessage = lines.join('\n');
          this.renderCombatMessage();
          // Rewards and continue handled in finishCombat
          this.finishCombat('win');
          return true;
        }
        if (this.hp <= 0) {
          lines.push('Player was defeated...');
          this.combatMessage = lines.join('\n');
          this.renderCombatMessage();
          this.finishCombat('lose');
          return true;
        }
        return false;
      };

      // Execute turns in order; stop if someone is KO'd
      for (const who of order) {
        const ended = attackOnce(who);
        if (ended) return;
      }

      // Round ends without KO; update UI
      this.combatMessage = lines.join('\n');
      this.renderStatus();
      this.renderCombatMessage();
    }

    finishCombat(outcome) {
      // outcome: 'win' | 'run' | 'lose'
      if (outcome === 'win') {
        // Apply rewards
        const gainedExp = 10;
        const gainedGold = 10;
        this.stats.xp += gainedExp;
        this.stats.gold += gainedGold;

        // Show end-of-battle summary, and wait for key press to continue
        const rewardLine = `Victory! You gained ${gainedExp} EXP and ${gainedGold} Gold.`;
        if (!this.combatMessage || !this.combatMessage.includes('EXP') || !this.combatMessage.includes('Gold')) {
          this.combatMessage = this.combatMessage ? `${this.combatMessage}\n${rewardLine}` : rewardLine;
        }
        this.renderStatus();
        this.renderCombatMessage();

        this.awaitContinue = 'win';
        return;
      }
      if (outcome === 'run') {
        // Show a line and wait for key press to return to overworld
        if (!this.combatMessage) {
          this.combatMessage = 'You ran away!';
          this.renderCombatMessage();
        }
        this.awaitContinue = 'run';
        return;
      }
      if (outcome === 'lose') {
        this.enemy = null;
        alert('You were defeated! The demo will restart.');
        this.restartDemo();
        return;
      }
    }

    restartDemo() {
      // Reset core variables
      this.hp = this.stats.maxHp;
      this.stats.xp = 0;
      this.stats.gold = 0;
      this.generateWorld();
      this.placePlayerOnLand();
      this.resetEncounterCounter();
      this.startCutscene();
    }

    endDemo() {
      const again = confirm(`Demo complete!\n\nEXP: ${this.stats.xp}\nGold: ${this.stats.gold}\n\nRestart?`);
      if (again) {
        this.restartDemo();
      }
    }

    resolvePostCombat() {
      const outcome = this.awaitContinue;
      this.awaitContinue = null;
      if (outcome === 'win' || outcome === 'run') {
        this.enemy = null;
        this.startOverworld();
        return;
      }
      if (outcome === 'lose') {
        this.enemy = null;
        this.restartDemo();
        return;
      }
    }

    // ---------- RENDER ----------
    render() {
      // States visibility
      this.$.dialogue.classList.toggle('hidden', this.current !== State.CUTSCENE);
      this.$.combat.classList.toggle('hidden', this.current !== State.COMBAT);

      if (this.current === State.CUTSCENE) {
        const text = this.cutsceneLines[this.cutIndex] || '';
        this.$.dialogueText.textContent = text;
      }

      this.renderMap();
      this.renderStatus();
      this.renderChoices();
      this.renderCombatMessage();
    }

    renderMap() {
      // Build grid only once or when size changes
      const container = this.$.map;
      container.innerHTML = '';

      const grid = document.createElement('div');
      grid.className = 'map-grid';
      grid.style.gridTemplateColumns = `repeat(${this.mapWidth}, ${this.tileSize}px)`;
      grid.style.gridTemplateRows = `repeat(${this.mapHeight}, ${this.tileSize}px)`;

      for (let y = 0; y < this.mapHeight; y++) {
        for (let x = 0; x < this.mapWidth; x++) {
          const tile = document.createElement('div');
          tile.className = `tile ${this.tiles[y][x]}`;
          if (x === this.player.x && y === this.player.y) {
            const p = document.createElement('div');
            p.className = 'player';
            tile.appendChild(p);
          }
          grid.appendChild(tile);
        }
      }
      container.appendChild(grid);
    }

    renderStatus() {
      this.$.hp.textContent = `${this.hp}/${this.stats.maxHp}`;
      if (this.$.exp) this.$.exp.textContent = String(this.stats.xp);
      if (this.$.gold) this.$.gold.textContent = String(this.stats.gold);
    }

    renderChoices() {
      this.$.choices.forEach((el, idx) => {
        el.classList.toggle('selected', idx === this.choiceIndex);
      });
    }

    renderCombatMessage() {
      this.$.combatMsg.textContent = this.current === State.COMBAT ? this.combatMessage : '';
    }
  }

  // ---------- Utilities ----------
  function int(v, fallback=0){
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  }
  function clamp(n, a, b){ return Math.min(Math.max(n, a), b); }
  function randInt(min, max){ return (Math.random() * (max - min + 1) | 0) + min; }
  function keyToDir(key){
    if (key === 'ArrowUp') return {x:0, y:-1};
    if (key === 'ArrowDown') return {x:0, y:1};
    if (key === 'ArrowLeft') return {x:-1, y:0};
    if (key === 'ArrowRight') return {x:1, y:0};
    return null;
  }
  // Simple deterministic-ish noise from coordinates
  function noise2d(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  // ---------- Bootstrap ----------
  window.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    const game = new Game(root);

    // global toggle with ` as well
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') {
        game.toggleDev();
      }
    });
  });
})();