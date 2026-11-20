import { PRODUCT } from "@crm/validation/product";
import { MAGIC_LINK } from "./auth-config";
import type { WorkspaceRole } from "./organization";

export type EmailContent = {
	subject: string;
	text: string;
	html: string;
};

type Layout = {
	heading: string;
	lines: string[];
	action: { label: string; url: string };
	footnote: string;
};

const STYLE = {
	body: "margin:0;padding:32px 16px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#171717;",
	card: "max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;",
	product: "margin:0 0 24px;font-size:13px;font-weight:600;color:#737373;",
	heading: "margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;",
	line: "margin:0 0 16px;font-size:14px;line-height:22px;",
	button:
		"display:inline-block;margin:8px 0 24px;padding:10px 18px;background:#171717;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;",
	fallback:
		"margin:0 0 16px;font-size:12px;line-height:18px;color:#737373;word-break:break-all;",
	footnote: "margin:0;font-size:12px;line-height:18px;color:#737373;",
} as const;

const ROLE_PHRASE = {
	owner: "an owner",
	admin: "an admin",
	member: "a member",
} as const satisfies Record<WorkspaceRole, string>;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function render({ heading, lines, action, footnote }: Layout): {
	text: string;
	html: string;
} {
	const text = [
		heading,
		...lines,
		`${action.label}: ${action.url}`,
		footnote,
	].join("\n\n");

	const url = escapeHtml(action.url);
	const html = [
		"<!doctype html>",
		'<html lang="en">',
		`<body style="${STYLE.body}">`,
		`<div style="${STYLE.card}">`,
		`<p style="${STYLE.product}">${escapeHtml(PRODUCT.name)}</p>`,
		`<h1 style="${STYLE.heading}">${escapeHtml(heading)}</h1>`,
		...lines.map((line) => `<p style="${STYLE.line}">${escapeHtml(line)}</p>`),
		`<a href="${url}" style="${STYLE.button}">${escapeHtml(action.label)}</a>`,
		`<p style="${STYLE.fallback}">Button not working? Copy this link into your browser: ${url}</p>`,
		`<p style="${STYLE.footnote}">${escapeHtml(footnote)}</p>`,
		"</div>",
		"</body>",
		"</html>",
	].join("\n");

	return { text, html };
}

export function magicLinkEmail({ url }: { url: string }): EmailContent {
	return {
		subject: `Sign in to ${PRODUCT.name}`,
		...render({
			heading: `Sign in to ${PRODUCT.name}`,
			lines: [
				`Use this link to sign in. It works one time and expires in ${MAGIC_LINK.expiresInMinutes} minutes.`,
			],
			action: { label: "Sign in", url },
			footnote:
				"Ignore this email if you did not ask for it. Nobody can sign in without this link.",
		}),
	};
}

export function invitationEmail({
	workspaceName,
	inviterName,
	role,
	email,
	url,
	expiresInDays,
}: {
	workspaceName: string;
	inviterName: string;
	role: WorkspaceRole;
	email: string;
	url: string;
	expiresInDays: number;
}): EmailContent {
	const workspace = singleLine(workspaceName);
	const inviter = singleLine(inviterName);

	return {
		subject: `${inviter} invited you to ${workspace} on ${PRODUCT.name}`,
		...render({
			heading: `Join ${workspace} on ${PRODUCT.name}`,
			lines: [
				`${inviter} invited you to join the ${workspace} workspace as ${ROLE_PHRASE[role]}.`,
				`Sign in with ${email} to accept. The invitation expires in ${expiresInDays} days.`,
			],
			action: { label: "View invitation", url },
			footnote: "Ignore this email if you do not know the sender.",
		}),
	};
}
