import { Plugin } from "@opencode/plugin";
import { ActivityMonitor } from "./activity.js";
import { defaultHelperPath, helperLease } from "./helper.js";
import { parseOptions } from "./options.js";
import { snapshotReader } from "./service.js";

export default Plugin.define({
  id: "liubsp.opencode-awake",
  setup(ctx) {
    const warn = (message: string) => console.warn(`[opencode-awake] ${message}`);
    if (process.platform !== "win32" && process.platform !== "darwin") {
      warn("this plugin supports Windows and macOS");
      return;
    }
    const options = parseOptions(ctx.options);
    const debug = options.debug ? (message: string) => console.info(`[opencode-awake] ${message}`) : () => {};
    const lease = helperLease(options.helperPath ?? defaultHelperPath(), warn, debug);
    const monitor = new ActivityMonitor({
      snapshot: snapshotReader(options),
      subscribe: (signal) => ctx.event.subscribe({ signal }),
    }, (active) => lease.update(active), options, warn);
    monitor.start();
    debug(`loaded on OpenCode ${ctx.app.version}; system-only power assertions`);
    return async () => {
      try { await monitor.stop(); } finally { await lease.dispose(); }
    };
  },
});
