import { loadRootEnv } from "@crm/env";
import type { NextConfig } from "next";

loadRootEnv();

const allowedDevOrigins = (process.env.APP_URL ?? "")
	.split(",")
	.flatMap((origin) => {
		try {
			return [new URL(origin.trim()).hostname];
		} catch {
			return [];
		}
	});

const nextConfig: NextConfig = {
	allowedDevOrigins,

	...(process.env.CRM_PROJECT_PROXY === "1" && {
		pageExtensions: ["tsx", "ts", "jsx"],
	}),

	transpilePackages: ["@crm/auth", "@crm/db", "@crm/telemetry", "@crm/ui"],

	serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

	images: {
		remotePatterns: [
			{ protocol: "https", hostname: "**.blob.vercel-storage.com" },
			{ protocol: "https", hostname: "*.storage.*.*.aws.neon.tech" },
		],
	},

	cacheComponents: true,
	partialPrefetching: true,
};

export default nextConfig;
