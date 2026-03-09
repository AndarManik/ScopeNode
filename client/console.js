export const newConsole = (app) => {
  const cmd = {};
  const Console = document.getElementById("Console");

  // layout
  Console.style.display = "none";
  Console.style.flexDirection = "column";

  let shown = false;

  // scrollable output
  const log = document.createElement("div");
  log.style.flex = "1";
  log.style.overflowY = "auto";
  log.style.padding = "6px";
  log.style.fontFamily = "monospace";

  // input field
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Enter command...";
  input.style.border = "none";
  input.style.outline = "none";
  input.style.padding = "6px";
  input.style.fontFamily = "monospace";
  input.style.background = "transparent";
  input.style.color = "inherit";

  Console.appendChild(log);
  Console.appendChild(input);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "`") return;
    event.preventDefault();

    shown = !shown;
    Console.style.display = shown ? "flex" : "none";

    if (shown) input.focus();
  });

  // helper to print messages
  cmd.print = (text) => {
    const line = document.createElement("p");
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  };

  // command reader
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;

    const raw = input.value.trim();
    if (!raw) return;

    cmd.print("> " + raw);

    const parts = raw.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case "help":
        cmd.print("Commands: help, clear, echo");
        break;

      case "clear":
        log.innerHTML = "";
        break;

      case "echo":
        cmd.print(args.join(" "));
        break;

      default:
        cmd.print(`Unknown command: ${command}`);
        break;
    }

    input.value = "";
  });

  return cmd;
};
