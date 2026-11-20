import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(apiDir));
const funcDir = join(apiDir, "dist/vercel");
const bun = process.env.BUN_BIN || "bun";

const EXTERNALS = [
	"@nestjs/microservices",
	"@nestjs/websockets",
	"@nestjs/platform-fastify",
	"@nestjs/graphql",
	"@nestjs/swagger",
	"class-transformer/storage",
	"pg-native",
	"better-sqlite3",
	"cardinal",
];

const VENDOR_ROOTS = [
	"express",
	"@nestjs/swagger",
	"reflect-metadata",
	"@nestjs/common",
	"@nestjs/core",
	"class-transformer",
	"class-validator",
];

rmSync(funcDir, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });

console.log("• bundling function with bun build...");
execFileSync(
	bun,
	[
		"build",
		"src/main.ts",
		"--target=node",
		"--format=esm",
		"--outfile",
		join(funcDir, "main.mjs"),
		...EXTERNALS.flatMap((name) => ["--external", name]),
	],
	{
		cwd: apiDir,
		stdio: "inherit",
		env: { ...process.env, NODE_ENV: "production" },
	},
);

console.log("• vendoring runtime-resolved dependencies...");
const bunStore = join(repoRoot, "node_modules/.bun");
const stores = existsSync(bunStore) ? readdirSync(bunStore) : [];
const funcNm = join(funcDir, "node_modules");
mkdirSync(funcNm, { recursive: true });
let vendorCount = 0;

function findInStore(name) {
	const enc = name.replace(/\//g, "+");
	for (const d of stores.filter((s) => s.startsWith(`${enc}@`))) {
		const p = join(bunStore, d, "node_modules", name);
		if (existsSync(p)) return p;
	}
	return null;
}

function packageVersion(dir) {
	try {
		return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
	} catch {
		return null;
	}
}

function resolveDep(realDir, name, depName) {
	const storeNm = realDir.slice(0, realDir.length - name.length);
	const candidate = join(storeNm, depName);
	if (existsSync(candidate)) return realpathSync(candidate);
	return findInStore(depName);
}

function place(realDir, dest) {
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(realDir, dest, { recursive: true, dereference: true });
	vendorCount++;
}

function vendorDeps(realDir, name, placedDir) {
	let pj;
	try {
		pj = JSON.parse(readFileSync(join(realDir, "package.json"), "utf8"));
	} catch {
		return;
	}
	const optionalPeers = new Set(
		Object.entries(pj.peerDependenciesMeta || {})
			.filter(([, meta]) => meta.optional)
			.map(([depName]) => depName),
	);
	const depNames = new Set([
		...Object.keys(pj.dependencies || {}),
		...Object.keys(pj.peerDependencies || {}).filter(
			(depName) => !optionalPeers.has(depName),
		),
	]);
	for (const depName of depNames) {
		const depReal = resolveDep(realDir, name, depName);
		if (!depReal) {
			console.warn(`  ! not found: ${depName} (needed by ${name})`);
			continue;
		}
		vendor(depName, depReal, placedDir);
	}
}

function vendor(name, realDir, dependentDir) {
	const rootDest = join(funcNm, name);
	if (!existsSync(rootDest)) {
		place(realDir, rootDest);
		vendorDeps(realDir, name, rootDest);
		return;
	}
	if (packageVersion(rootDest) === packageVersion(realDir)) return;
	const nested = join(dependentDir, "node_modules", name);
	if (existsSync(nested)) return;
	place(realDir, nested);
	vendorDeps(realDir, name, nested);
}

for (const root of VENDOR_ROOTS) {
	const dir = findInStore(root);
	if (!dir) {
		console.warn(`  ! not found: ${root}`);
		continue;
	}
	vendor(root, realpathSync(dir), funcNm);
}
console.log(`  vendored ${vendorCount} packages`);

console.log(`✓ built ${funcDir}`);
