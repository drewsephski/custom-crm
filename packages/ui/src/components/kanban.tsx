"use client";

import { Icon } from "@crm/ui/components/icon";
import { KANBAN } from "@crm/ui/lib/interaction-config";
import { cn } from "@crm/ui/lib/utils";
import {
	type Announcements,
	closestCorners,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardCode,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useId, useRef, useState } from "react";

export type KanbanColumnData = {
	id: string;
	label: string;
	itemIds: string[];
};

export type KanbanMove = {
	itemId: string;
	fromColumnId: string;
	toColumnId: string;
	index: number;
	afterId: string | null;
	beforeId: string | null;
};

type Order = Record<string, string[]>;

function escapeAttribute(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}

function orderOf(columns: KanbanColumnData[]): Order {
	return Object.fromEntries(
		columns.map((column) => [column.id, column.itemIds]),
	);
}

function columnOf(order: Order, id: string): string | null {
	if (id in order) return id;
	for (const [columnId, itemIds] of Object.entries(order)) {
		if (itemIds.includes(id)) return columnId;
	}
	return null;
}

function Kanban({
	label,
	columns,
	itemLabel,
	onMove,
	renderHeader,
	renderCard,
	renderEmpty,
	renderFooter,
	className,
}: {
	label: string;
	columns: KanbanColumnData[];
	itemLabel: (itemId: string) => string;
	onMove: (move: KanbanMove) => void;
	renderHeader: (columnId: string) => ReactNode;
	renderCard: (itemId: string) => ReactNode;
	renderEmpty?: (columnId: string) => ReactNode;
	renderFooter?: (columnId: string) => ReactNode;
	className?: string;
}) {
	const instructionsId = useId();
	const board = useRef<HTMLElement>(null);
	const reduceMotion = useReducedMotion();
	const [dragOrder, setDragOrder] = useState<Order | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);

	const settled = orderOf(columns);
	const order = dragOrder ?? settled;
	const columnLabel = (columnId: string | null) =>
		columns.find((column) => column.id === columnId)?.label ?? "the board";

	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: { distance: KANBAN.drag.mouseDistancePx },
		}),
		useSensor(TouchSensor, {
			activationConstraint: {
				delay: KANBAN.drag.touchDelayMs,
				tolerance: KANBAN.drag.touchTolerancePx,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
			keyboardCodes: {
				start: [KeyboardCode.Space],
				cancel: [KeyboardCode.Esc],
				end: [KeyboardCode.Space],
			},
		}),
	);

	const landing = (itemId: string, overId: string) => {
		const columnId = columnOf(order, itemId);
		const items = columnId ? (order[columnId] ?? []) : [];
		const from = items.indexOf(itemId);
		const over = items.indexOf(overId);
		const final =
			over >= 0 && over !== from ? arrayMove(items, from, over) : items;
		return { columnId, items: final, index: final.indexOf(itemId) };
	};

	const place = (itemId: string, overId: string) => {
		const { columnId, items, index } = landing(itemId, overId);
		return columnId && index >= 0
			? `position ${index + 1} of ${items.length} in ${columnLabel(columnId)}`
			: columnLabel(columnId);
	};

	const announcements: Announcements = {
		onDragStart: ({ active }) =>
			`Picked up ${itemLabel(String(active.id))} in ${columnLabel(columnOf(order, String(active.id)))}.`,
		onDragOver: ({ active, over }) =>
			over
				? `${itemLabel(String(active.id))} is at ${place(String(active.id), String(over.id))}.`
				: `${itemLabel(String(active.id))} is not over a column.`,
		onDragEnd: ({ active, over }) =>
			over
				? `Dropped ${itemLabel(String(active.id))} at ${place(String(active.id), String(over.id))}.`
				: `${itemLabel(String(active.id))} went back to where it was.`,
		onDragCancel: ({ active }) =>
			`Cancelled. ${itemLabel(String(active.id))} went back to where it was.`,
	};

	const onDragStart = ({ active }: DragStartEvent) => {
		setActiveId(String(active.id));
		setDragOrder(settled);
	};

	const onDragOver = ({ active, over }: DragOverEvent) => {
		if (!over) return;
		const itemId = String(active.id);
		const overId = String(over.id);

		setDragOrder((current) => {
			const base = current ?? settled;
			const from = columnOf(base, itemId);
			const to = columnOf(base, overId);
			if (!from || !to || from === to) return base;

			const target = base[to] ?? [];
			const overIndex = target.indexOf(overId);
			const translated = active.rect.current.translated;
			const below =
				overIndex >= 0 &&
				translated !== null &&
				translated.top > over.rect.top + over.rect.height / 2;
			const index =
				overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;

			return {
				...base,
				[from]: (base[from] ?? []).filter((id) => id !== itemId),
				[to]: [...target.slice(0, index), itemId, ...target.slice(index)],
			};
		});
	};

	const finish = () => {
		setActiveId(null);
		setDragOrder(null);
	};

	const refocus = (itemId: string) => {
		requestAnimationFrame(() => {
			board.current
				?.querySelector<HTMLElement>(`[data-kanban-handle="${escapeAttribute(itemId)}"]`)
				?.focus();
		});
	};

	const onDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
		const itemId = String(active.id);
		const fromColumnId = columnOf(settled, itemId);
		const {
			columnId: toColumnId,
			items: final,
			index,
		} = over
			? landing(itemId, String(over.id))
			: { columnId: null, items: [], index: -1 };
		finish();
		if (activatorEvent instanceof KeyboardEvent) refocus(itemId);
		if (!over || !toColumnId || !fromColumnId) return;

		const before = settled[fromColumnId]?.indexOf(itemId) ?? -1;

		if (fromColumnId === toColumnId && index === before) return;

		onMove({
			itemId,
			fromColumnId,
			toColumnId,
			index,
			afterId: final[index - 1] ?? null,
			beforeId: final[index + 1] ?? null,
		});
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCorners}
			accessibility={{
				announcements,
				screenReaderInstructions: {
					draggable:
						"To move this card, press Space. Use the arrow keys to move it between columns and within a column. Press Space again to drop it, or Escape to cancel.",
				},
			}}
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDragEnd={onDragEnd}
			onDragCancel={finish}
		>
			<section
				ref={board}
				data-slot="kanban"
				aria-label={label}
				aria-describedby={instructionsId}
				className={cn(
					"relative flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:snap-none",
					className,
				)}
			>
				<p id={instructionsId} className="sr-only">
					Each card has a move button for the keyboard and a menu that moves it
					without dragging.
				</p>
				{columns.map((column) => (
					<KanbanColumn
						key={column.id}
						id={column.id}
						label={column.label}
						itemIds={order[column.id] ?? []}
						header={renderHeader(column.id)}
						empty={renderEmpty?.(column.id)}
						footer={renderFooter?.(column.id)}
					>
						{(order[column.id] ?? []).map((itemId) => (
							<KanbanCard
								key={itemId}
								id={itemId}
								label={itemLabel(itemId)}
								ghost={itemId === activeId}
							>
								{renderCard(itemId)}
							</KanbanCard>
						))}
					</KanbanColumn>
				))}
			</section>
			<DragOverlay dropAnimation={reduceMotion ? null : undefined}>
				{activeId ? (
					<div
						data-slot="kanban-overlay"
						className="cursor-grabbing rounded-md bg-card p-3 text-sm shadow-menu"
					>
						{renderCard(activeId)}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function KanbanColumn({
	id,
	label,
	itemIds,
	header,
	empty,
	footer,
	children,
}: {
	id: string;
	label: string;
	itemIds: string[];
	header: ReactNode;
	empty?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id });

	return (
		<section
			data-slot="kanban-column"
			data-over={isOver || undefined}
			aria-label={label}
			className="relative flex max-h-full w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-lg bg-muted/50 shadow-border transition-colors data-over:bg-muted md:w-72"
		>
			<header className="flex items-start gap-2 px-3 pt-3 pb-2">{header}</header>
			<SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
				<ul
					ref={setNodeRef}
					className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
				>
					{children}
					{itemIds.length === 0 && empty ? (
						<li className="flex flex-1 items-center justify-center px-2 py-6 text-center text-13 text-muted-foreground">
							{empty}
						</li>
					) : null}
				</ul>
			</SortableContext>
			{footer ? (
				<footer className="border-t px-3 py-2 text-13">{footer}</footer>
			) : null}
		</section>
	);
}

function KanbanCard({
	id,
	label,
	ghost,
	children,
}: {
	id: string;
	label: string;
	ghost: boolean;
	children: ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
	} = useSortable({ id });

	return (
		<li
			ref={setNodeRef}
			data-slot="kanban-card"
			data-ghost={ghost || undefined}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className="group/kanban-card relative cursor-grab touch-manipulation rounded-md bg-card p-3 text-sm shadow-border data-ghost:opacity-40"
			{...listeners}
		>
			<button
				ref={setActivatorNodeRef}
				type="button"
				data-kanban-handle={id}
				className="absolute top-2.5 -left-1 flex h-6 w-4 cursor-grab items-center justify-center rounded-sm bg-card text-muted-foreground opacity-0 shadow-border outline-none transition-opacity focus-visible:opacity-100 focus-visible:shadow-focus group-hover/kanban-card:opacity-100"
				{...attributes}
			>
				<Icon icon={GripVerticalIcon} motion="none" />
				<span className="sr-only">Move {label}</span>
			</button>
			{children}
		</li>
	);
}

function KanbanSkeleton({ columns = 4 }: { columns?: number }) {
	const slots = Array.from({ length: columns }, (_, index) => index);

	return (
		<div
			data-slot="kanban-skeleton"
			aria-hidden
			className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-2"
		>
			{slots.map((slot) => (
				<div
					key={slot}
					className="flex w-[85vw] max-w-80 shrink-0 flex-col gap-2 rounded-lg bg-muted/50 p-3 shadow-border md:w-72"
				>
					<div className="h-4 w-24 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
					{Array.from({ length: 3 - (slot % 2) }, (_, card) => card).map(
						(card) => (
							<div
								key={card}
								className="h-20 animate-pulse rounded-md bg-card shadow-border motion-reduce:animate-none"
							/>
						),
					)}
				</div>
			))}
		</div>
	);
}

export { Kanban, KanbanSkeleton };
