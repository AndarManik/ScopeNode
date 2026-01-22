import { jiggleApp } from "../screentransform.js";

export const settings = (app) => {
  const { menu, socket } = app;
  const settingsObj = app.settings;
  jiggleApp();
  menu.reset();
  const previousScene = menu.scene;
  menu.scene = settings;

  const title = menu.newEl(6, 1, 6, 1);
  title.innerText = "Scope Node: Protocol";

  const returnButton = menu.newEl(15, 1, 2, 1, "button");
  returnButton.innerText = "Back";
  returnButton.addEventListener("click", () => previousScene(app));

  const escape = menu.newEl(1, 1, 2, 1, "button");
  escape.innerText = `Esc`;
  escape.addEventListener("click", menu.toggle);

  // first scrollable grid row (rows 1–2 are header + jump row, row 3 as spacer)
  const CONTENT_Y_START = 4;

  const scrollElements = new Set(); // currently rendered scrollable elements
  const rowDefs = [];
  const sectionIndices = { top: 0 };

  const clearScrollElements = () => {
    for (const el of scrollElements) menu.deleteEl(el);
    scrollElements.clear();
  };

  const registerElements = (elements) => {
    for (const el of elements) {
      if (!el) continue;
      scrollElements.add(el);
    }
  };

  // convenience: standard label + number input row
  const numberRowDef = (label, settings, name) => ({
    height: 1,
    create: (yBase) => {
      const elements = [];

      const labelEl = menu.newEl(2, yBase, 4, 1, "div");
      labelEl.innerText = label;
      elements.push(labelEl);

      const inputEl = menu.newEl(7, yBase, 9, 1, "input");
      inputEl.type = "number";
      inputEl.value = settings[name];
      inputEl.style.backgroundColor = "var(--input)";
      elements.push(inputEl);

      inputEl.addEventListener("input", () => {
        const v = Number(inputEl.value);
        if (!Number.isFinite(v)) return;
        settings[name] = v;
      });

      return elements;
    },
  });

  const spacerRowDef = {
    height: 1,
    create: () => [],
  };

  // ---------------------------------------------------------------------------
  // Category definitions (order here controls both layout and jump buttons)
  // ---------------------------------------------------------------------------

  const categories = [
    {
      key: "colors",
      jumpLabel: "Colors",
      headerLabel: "Color Settings",
      rows: [
        // Hue slider
        {
          height: 1,
          create: (yBase) => {
            const elements = [];

            const hueTitle = menu.newEl(2, yBase, 4, 1, "div");
            hueTitle.innerText = "Game Hue";
            elements.push(hueTitle);

            const hueInput = menu.newEl(7, yBase, 9, 1, "input");
            hueInput.type = "range";
            hueInput.min = "0";
            hueInput.max = "360";
            hueInput.step = "1";
            hueInput.value = settingsObj?.render?.hue ?? app.color.hue ?? 0;
            hueInput.style.backgroundColor = "var(--input)";
            elements.push(hueInput);

            hueInput.addEventListener("input", () => {
              const hue = Number(hueInput.value);
              app.color.setHue(hue);
            });

            return elements;
          },
        },
        // Color samples
        {
          height: 1,
          create: (yBase) => {
            const elements = [];
            const samples = [
              "--inputLeftOff",
              "--lightLeft",
              "--inputLeft",
              "--inputOff",
              "--light",
              "--input",
              "--inputRightOff",
              "--lightRight",
              "--inputRight",
            ];
            const startX = 7;
            const endX = 15;
            let x = startX;
            let y = yBase;
            for (const cssVar of samples) {
              const el = menu.newEl(x, y, 1, 1, "div");
              el.style.backgroundColor = `var(${cssVar})`;
              elements.push(el);
              x += 1;
              if (x > endX) {
                x = startX;
                y++;
              }
            }

            return elements;
          },
        },
      ],
    },
    {
      // RENDER COMES BEFORE SOLO HERE
      key: "render",
      jumpLabel: "Render",
      headerLabel: "Render Settings",
      rows: [
        numberRowDef("Scale", settingsObj.render, "scale"),
        // Glow Enabled
        {
          height: 1,
          create: (yBase) => {
            const elements = [];

            const labelEl = menu.newEl(2, yBase, 4, 1, "div");
            labelEl.innerText = "Glow Enabled";
            elements.push(labelEl);

            const selectEl = menu.newEl(7, yBase, 9, 1, "select");
            selectEl.style.backgroundColor = "var(--input)";
            elements.push(selectEl);

            const current = settingsObj.render.glowEnabled ? "on" : "off";

            const options = [
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ];

            for (const opt of options) {
              const o = document.createElement("option");
              o.value = opt.value;
              o.textContent = opt.label;
              if (opt.value === current) o.selected = true;
              selectEl.appendChild(o);
            }

            selectEl.addEventListener("change", () => {
              settingsObj.render.glowEnabled = selectEl.value === "on";
            });

            return elements;
          },
        },
        // Preferred side
        {
          height: 1,
          create: (yBase) => {
            const elements = [];

            const labelEl = menu.newEl(2, yBase, 4, 1, "div");
            labelEl.innerText = "Preferred Side";
            elements.push(labelEl);

            const selectEl = menu.newEl(7, yBase, 9, 1, "select");
            selectEl.style.backgroundColor = "var(--input)";
            elements.push(selectEl);

            const options = [
              { value: "none", label: "None" },
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ];

            const current = settingsObj.render.preferredSide ?? "none";

            for (const opt of options) {
              const o = document.createElement("option");
              o.value = opt.value;
              o.textContent = opt.label;
              if (opt.value === current) o.selected = true;
              selectEl.appendChild(o);
            }

            selectEl.addEventListener("change", () => {
              settingsObj.render.preferredSide = selectEl.value;
            });

            return elements;
          },
        },
        numberRowDef("Bullet Speed", settingsObj.render, "bulletSpeed"),
        numberRowDef("Shell Angle", settingsObj.render, "shellAngle"),
        numberRowDef("FPS Cap", settingsObj.render, "fpsCap"),
        {
          height: 1,
          create: (yBase) => {
            const elements = [];

            const labelEl = menu.newEl(2, yBase, 4, 1, "div");
            labelEl.innerText = "vSync";
            elements.push(labelEl);

            const selectEl = menu.newEl(7, yBase, 9, 1, "select");
            selectEl.style.backgroundColor = "var(--input)";
            elements.push(selectEl);

            const current = settingsObj.render.vSync ? "on" : "off";

            const options = [
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ];

            for (const opt of options) {
              const o = document.createElement("option");
              o.value = opt.value;
              o.textContent = opt.label;
              if (opt.value === current) o.selected = true;
              selectEl.appendChild(o);
            }

            selectEl.addEventListener("change", () => {
              settingsObj.render.vSync = selectEl.value === "on";
            });

            return elements;
          },
        },
      ],
    },
    {
      key: "game",
      jumpLabel: "Solo",
      headerLabel: "Solo Settings",
      rows: [
        numberRowDef("Player Radius", settingsObj.game, "playerRadius"),
        numberRowDef("Move Speed", settingsObj.game, "moveSpeed"),
        numberRowDef("Obstacle Area", settingsObj.game, "obstacleArea"),
        numberRowDef(
          "Obstacle Start Count",
          settingsObj.game,
          "obstacleStartCount"
        ),
      ],
    },
  ];

  // ---------------------------------------------------------------------------
  // Jump-to buttons row (fixed, non-scrolling)
  // (order follows categories array so you can just reorder there)
  // ---------------------------------------------------------------------------

  const jumpButtons = {};

  const jumpTop = menu.newEl(1, 2, 4, 1, "button");
  jumpTop.innerText = "Top";
  jumpButtons.top = jumpTop;

  // starting x=5 for first category (then +4 per category)
  categories.forEach((cat, idx) => {
    const x = 5 + idx * 4;
    const btn = menu.newEl(x, 2, 4, 1, "button");
    btn.innerText = cat.jumpLabel;
    jumpButtons[cat.key] = btn;
  });

  // ---------------------------------------------------------------------------
  // Row definitions (profile + categories)
  // ---------------------------------------------------------------------------

  // 0. Username row
  let nameInputDebounce;
  sectionIndices.top = rowDefs.length;
  rowDefs.push({
    height: 1,
    create: (yBase) => {
      const elements = [];

      const nameTitle = menu.newEl(2, yBase, 4, 1, "div");
      nameTitle.innerText = "Username";
      elements.push(nameTitle);

      const nameInput = menu.newEl(7, yBase, 9, 1, "input");
      nameInput.style.backgroundColor = "var(--input)";
      nameInput.value = app.name ?? "";
      elements.push(nameInput);

      nameInput.addEventListener("input", () => {
        nameInput.value = nameInput.value.slice(0, 100);
        app.name = nameInput.value;
        try {
          localStorage.setItem("name", nameInput.value);
        } catch (err) {
          console.error("localStorage write error (name):", err);
        }

        clearTimeout(nameInputDebounce);
        nameInputDebounce = setTimeout(() => {
          socket.json({ command: "name change", name: nameInput.value });
        }, 1000);
      });

      return elements;
    },
  });

  // spacer after username
  rowDefs.push(spacerRowDef);

  // Categories: header + rows + spacer (except after last)
  categories.forEach((cat, index) => {
    // Record the index for jump-to
    sectionIndices[cat.key] = rowDefs.length;

    // Header row
    rowDefs.push({
      height: 1,
      create: (yBase) => {
        const el = menu.newEl(7, yBase, 9, 1, "div");
        el.innerText = cat.headerLabel;
        return [el];
      },
    });

    // Category rows
    for (const row of cat.rows) {
      rowDefs.push(row);
    }

    // Spacer between categories (not after last)
    if (index < categories.length - 1) {
      rowDefs.push(spacerRowDef);
    }
  });

  // ---------------------------------------------------------------------------
  // Render logic
  // ---------------------------------------------------------------------------

  let scrollRowIndex = 0;
  const maxScrollIndex = Math.max(0, rowDefs.length - 1);

  const renderRows = () => {
    clearScrollElements();

    let y = CONTENT_Y_START;
    for (let i = scrollRowIndex; i < rowDefs.length; i++) {
      const row = rowDefs[i];
      const created = row.create(y) || [];
      registerElements(created);
      y += row.height;
      // can early-break if y is far off-screen, but not required
    }
  };

  // initial render
  renderRows();

  // ---------------------------------------------------------------------------
  // Wire up jump-to buttons
  // ---------------------------------------------------------------------------
  const jumpToSection = (sectionKey) => {
    const targetIndex = sectionIndices[sectionKey] ?? 0;
    const clamped = Math.min(maxScrollIndex, Math.max(0, targetIndex));
    if (clamped === scrollRowIndex) return;
    scrollRowIndex = clamped;
    renderRows();
  };

  jumpButtons.top.addEventListener("click", () => jumpToSection("top"));
  categories.forEach((cat) => {
    const btn = jumpButtons[cat.key];
    if (!btn) return;
    btn.addEventListener("click", () => jumpToSection(cat.key));
  });

  // ---------------------------------------------------------------------------
  // Scroll handler (wheel → integer row scroll)
  // ---------------------------------------------------------------------------
  const menuEl = document.getElementById("Menu");
  if (menuEl) {
    const onWheel = (event) => {
      // Only act if this scene is active
      if (menu.scene !== settings) return;

      const delta = Math.sign(event.deltaY);
      if (delta === 0) return;

      const oldIndex = scrollRowIndex;
      scrollRowIndex = Math.min(
        maxScrollIndex,
        Math.max(0, scrollRowIndex + delta)
      );

      if (scrollRowIndex !== oldIndex) {
        renderRows();
      }
    };

    // passive: false so we can preventDefault and avoid page scroll
    menuEl.addEventListener("wheel", onWheel, { passive: false });
  }
};
