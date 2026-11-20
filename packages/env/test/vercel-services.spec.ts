import { it } from "bun:test";
import config from "../../../vercel.json";

it("declares no circular Vercel service bindings", () => {
	const services = new Map(Object.entries(config.services));
	function visit(name: string, path: string[]) {
		if (path.includes(name)) throw new Error([...path, name].join(" -> "));
		const service = services.get(name);
		if (!service) throw new Error(`Unknown service: ${name}`);
		if ("bindings" in service) {
			for (const binding of service.bindings) {
				visit(binding.service, [...path, name]);
			}
		}
	}
	for (const name of services.keys()) visit(name, []);
});
