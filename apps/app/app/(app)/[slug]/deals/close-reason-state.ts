import { parseAsString } from "nuqs/server";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export type BoardPlacement = {
	afterId: string | null;
	beforeId: string | null;
};

export const closeReasonParams = {
	[SEARCH_PARAM.dialog.closeDeal]: parseAsString,
	[SEARCH_PARAM.dialog.closeStage]: parseAsString,
	[SEARCH_PARAM.dialog.closeAfter]: parseAsString,
	[SEARCH_PARAM.dialog.closeBefore]: parseAsString,
};

export type CloseReasonValues = {
	[Key in keyof typeof closeReasonParams]: string | null;
};

export const CLOSE_REASON_CLEARED: CloseReasonValues = {
	[SEARCH_PARAM.dialog.closeDeal]: null,
	[SEARCH_PARAM.dialog.closeStage]: null,
	[SEARCH_PARAM.dialog.closeAfter]: null,
	[SEARCH_PARAM.dialog.closeBefore]: null,
};

export function closeReasonRequest(
	dealId: string,
	stageId: string,
	placement?: BoardPlacement,
): CloseReasonValues {
	const afterId = placement?.afterId ?? null;
	return {
		[SEARCH_PARAM.dialog.closeDeal]: dealId,
		[SEARCH_PARAM.dialog.closeStage]: stageId,
		[SEARCH_PARAM.dialog.closeAfter]: afterId,
		[SEARCH_PARAM.dialog.closeBefore]: afterId
			? null
			: (placement?.beforeId ?? null),
	};
}

export function closeReasonPlacement(
	values: CloseReasonValues,
): BoardPlacement | undefined {
	const afterId = values[SEARCH_PARAM.dialog.closeAfter];
	const beforeId = values[SEARCH_PARAM.dialog.closeBefore];
	if (afterId) return { afterId, beforeId: null };
	if (beforeId) return { afterId: null, beforeId };
	return undefined;
}
