/**
 * Packaging checks for swarm-mail tarball exports.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SWARM_MAIL_VERSION } from "../index";

type PackageManifest = {
	version?: string;
	files?: string[];
	exports?: Record<string, unknown>;
	bin?: Record<string, string>;
};

/**
 * Reads the swarm-mail package.json for packaging assertions.
 */
function readPackageManifest(): PackageManifest {
	const manifestPath = join(import.meta.dir, "..", "..", "package.json");
	return JSON.parse(readFileSync(manifestPath, "utf-8")) as PackageManifest;
}

describe("swarm-mail tarball packaging", () => {
	test("SWARM_MAIL_VERSION matches package.json (tarball failed when versions drifted)", () => {
		const manifest = readPackageManifest();

		expect(manifest.version).toBe(SWARM_MAIL_VERSION);
	});

	test("publishes runtime assets needed by tarball", () => {
		const manifest = readPackageManifest();

		expect(manifest.files).toContain("dist");
		expect(manifest.files).toContain("bin");
		expect(manifest.files).toContain("README.md");
		expect(Object.keys(manifest.exports ?? {})).toContain(".");
		expect(manifest.bin).toHaveProperty("swarm-mail-daemon");
		expect(manifest.bin).toHaveProperty("swarm-db");
	});
});
