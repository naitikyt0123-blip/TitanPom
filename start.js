const { spawn, execSync } = require("child_process");

// Chromium ka path dhundh ke env me set karo (sab bots ke liye)
try {
  const chromiumPath = execSync("which chromium || find /nix/store -name chromium -type f 2>/dev/null | head -n 1", {
    encoding: "utf8",
  }).trim();
  if (chromiumPath) {
    process.env.CHROMIUM_PATH = chromiumPath;
    console.log("✓ Chromium path set: " + chromiumPath);
  } else {
    console.log("⚠️ Chromium path nahi mila");
  }
} catch (e) {
  console.log("⚠️ Chromium dhundhne me error: " + e.message);
}

function run(file) {
  const p = spawn("node", [file], {
    stdio: "inherit",
    env: process.env, // chromium path pass karo
  });

  p.on("exit", (code) => {
    console.log(`${file} exited with code ${code}`);
  });
}
run("index.js");
