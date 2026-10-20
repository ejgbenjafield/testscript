import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** A vertical list that can be reordered by dragging the handle, or with the keyboard (Space, arrows, Space). */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  children,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((i) => i.id);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  disabled,
  children,
  className = '',
  as: Tag = 'li',
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  as?: 'li' | 'div';
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="cursor-grab touch-none rounded px-1 py-1 text-ink-faint hover:bg-canvas hover:text-ink-soft active:cursor-grabbing"
    >
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden fill="currentColor">
        {[3, 8, 13].map((y) => (
          <g key={y}>
            <circle cx="3.5" cy={y} r="1.4" />
            <circle cx="8.5" cy={y} r="1.4" />
          </g>
        ))}
      </svg>
    </button>
  );
  return (
    <Tag
      ref={setNodeRef as any}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${className} ${isDragging ? 'relative z-10 shadow-lg' : ''}`}
    >
      {children(handle)}
    </Tag>
  );
}
