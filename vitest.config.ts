import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		env: {
			// Pin the UI locale: detection falls back to the OS locale, which varies per machine.
			PI_ASK_USER_LOCALE: "en",
			// Keep config reads away from the real ~/.pi/agent.
			PI_CODING_AGENT_DIR: join(tmpdir(), "pi-ask-user-test-agent"),
		},
	},
});
