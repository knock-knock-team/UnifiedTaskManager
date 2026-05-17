import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildDefaultPositions(projectLabel, columns, tasksByColumn) {
  const canvasW = 1240;
  const pos = {};
  pos.__root__ = {
    x: canvasW / 2 - 100,
    y: 20,
    w: 200,
    h: 42,
    label: projectLabel || 'Проект',
    kind: 'root'
  };
  const n = Math.max(columns.length, 1);
  const slot = (canvasW - 100) / n;
  columns.forEach((col, i) => {
    const x = 50 + i * slot + (slot - 200) / 2;
    pos[col.id] = {
      x: clamp(x, 20, canvasW - 220),
      y: 110,
      w: 200,
      h: 40,
      label: col.title,
      kind: 'column',
      columnId: col.id
    };
    const tasks = tasksByColumn[col.id] || [];
    tasks.forEach((task, ti) => {
      const row = Math.floor(ti / 2);
      const colOff = (ti % 2) * 108;
      pos[task.id] = {
        x: clamp(pos[col.id].x - 8 + colOff, 8, canvasW - 228),
        y: 210 + row * 58,
        w: 216,
        h: 48,
        label: task.title || 'Без названия',
        kind: 'task',
        taskId: task.id,
        columnId: col.id
      };
    });
  });
  return pos;
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function loadSaved(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveData(storageKey, positions, strokes) {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ positions, strokes, updatedAt: Date.now() }));
  } catch {
    // ignore quota
  }
}

function buildLayoutKey(storageKey, projectLabel, columns, tasksByColumn) {
  const colIds = columns.map((c) => c.id).join('|');
  const taskIds = columns
    .map((c) => (tasksByColumn[c.id] || []).map((t) => t.id).join(','))
    .join(';');
  return `${storageKey}::${projectLabel}::${colIds}::${taskIds}`;
}

export function TaskMindMapPanel({
  storageKey,
  projectLabel,
  columns,
  tasksByColumn,
  onOpenTask,
  isTaskDone,
  isTaskOverdue
}) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('map');
  const [positions, setPositions] = useState({});
  const [strokes, setStrokes] = useState([]);
  const dragRef = useRef(null);
  const drawRef = useRef(null);

  const layoutKey = useMemo(
    () => buildLayoutKey(storageKey, projectLabel || '', columns, tasksByColumn),
    [storageKey, projectLabel, columns, tasksByColumn]
  );

  useEffect(() => {
    if (!storageKey) {
      setPositions({});
      setStrokes([]);
      return;
    }
    const built = buildDefaultPositions(projectLabel, columns, tasksByColumn);
    const saved = loadSaved(storageKey);
    const merged = { ...built };
    if (saved?.positions && typeof saved.positions === 'object') {
      Object.keys(saved.positions).forEach((id) => {
        if (merged[id]) {
          merged[id] = { ...merged[id], ...saved.positions[id] };
        }
      });
    }
    setPositions(merged);
    setStrokes(Array.isArray(saved?.strokes) ? saved.strokes : []);
  }, [layoutKey, projectLabel, columns, tasksByColumn, storageKey]);

  useEffect(() => {
    const t = setTimeout(() => saveData(storageKey, positions, strokes), 400);
    return () => clearTimeout(t);
  }, [storageKey, positions, strokes]);

  const contentSize = useMemo(() => {
    let maxY = 420;
    Object.values(positions).forEach((r) => {
      if (r && typeof r.y === 'number' && typeof r.h === 'number') {
        maxY = Math.max(maxY, r.y + r.h + 48);
      }
    });
    return { width: 1240, height: maxY };
  }, [positions]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = contentSize.width;
    const h = contentSize.height;
    if (w < 16 || h < 16) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    // Не менять width/height на каждый move при рисовании — сброс буфера
    // каждый кадр в Chromium может давать чёрный экран или «пропадающую» карту под канвасом.
    const sizeChanged = canvas.width !== bw || canvas.height !== bh;
    if (sizeChanged) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const paintStroke = (stroke) => {
      if (!stroke.points?.length) return;
      ctx.strokeStyle = stroke.color || 'rgba(126, 200, 255, 0.55)';
      ctx.lineWidth = stroke.width || 2.2;
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    };
    strokes.forEach(paintStroke);
    if (drawRef.current?.points?.length) {
      paintStroke({ points: drawRef.current.points, color: 'rgba(160, 220, 255, 0.75)', width: 2.4 });
    }
  }, [strokes, contentSize.width, contentSize.height]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const edges = useMemo(() => {
    const root = positions.__root__;
    if (!root) return [];
    const list = [];
    const rc = centerOf(root);
    columns.forEach((col) => {
      const c = positions[col.id];
      if (!c) return;
      const cc = centerOf(c);
      list.push({ x1: rc.x, y1: root.y + root.h, x2: cc.x, y2: c.y, key: `r-${col.id}` });
      const tasks = tasksByColumn[col.id] || [];
      tasks.forEach((task) => {
        const t = positions[task.id];
        if (!t) return;
        const tc = centerOf(t);
        list.push({ x1: cc.x, y1: c.y + c.h, x2: tc.x, y2: t.y, key: `${col.id}-${task.id}` });
      });
    });
    return list;
  }, [positions, columns, tasksByColumn]);

  const onNodePointerDown = useCallback(
    (event, id) => {
      if (mode !== 'map') return;
      const wrap = viewportRef.current;
      if (!wrap) return;
      const node = positions[id];
      if (!node) return;
      const rect = wrap.getBoundingClientRect();
      const px = event.clientX - rect.left + wrap.scrollLeft;
      const py = event.clientY - rect.top + wrap.scrollTop;
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        offsetX: px - node.x,
        offsetY: py - node.y
      };
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [mode, positions]
  );

  const onViewportPointerMove = useCallback(
    (event) => {
      const d = dragRef.current;
      if (!d || mode !== 'map') return;
      const dist = Math.abs(event.clientX - d.startX) + Math.abs(event.clientY - d.startY);
      if (dist <= 5) return;
      d.moved = true;
      const wrap = viewportRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const nx = event.clientX - rect.left + wrap.scrollLeft - d.offsetX;
      const ny = event.clientY - rect.top + wrap.scrollTop - d.offsetY;
      setPositions((prev) => {
        const cur = prev[d.id];
        if (!cur) return prev;
        return {
          ...prev,
          [d.id]: {
            ...cur,
            x: clamp(nx, 0, contentSize.width - cur.w),
            y: clamp(ny, 0, contentSize.height - cur.h)
          }
        };
      });
    },
    [mode, contentSize.width, contentSize.height]
  );

  const endDrag = useCallback(
    (event) => {
      if (mode === 'draw') {
        return;
      }
      const d = dragRef.current;
      if (d && !d.moved && positions[d.id]?.kind === 'task') {
        const colId = positions[d.id].columnId;
        const task = (tasksByColumn[colId] || []).find((t) => t.id === d.id);
        if (task) onOpenTask?.(task);
      }
      dragRef.current = null;
      const wrap = viewportRef.current;
      if (wrap && event?.pointerId != null) {
        try {
          wrap.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [mode, onOpenTask, positions, tasksByColumn]
  );

  const onCanvasPointerDown = useCallback(
    (event) => {
      if (mode !== 'draw') return;
      event.stopPropagation();
      const wrap = viewportRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = event.clientX - rect.left + wrap.scrollLeft;
      const y = event.clientY - rect.top + wrap.scrollTop;
      drawRef.current = { points: [{ x, y }] };
      canvasRef.current?.setPointerCapture(event.pointerId);
      redrawCanvas();
    },
    [mode, redrawCanvas]
  );

  const onCanvasPointerMove = useCallback(
    (event) => {
      if (mode !== 'draw' || !drawRef.current) return;
      event.stopPropagation();
      const wrap = viewportRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = event.clientX - rect.left + wrap.scrollLeft;
      const y = event.clientY - rect.top + wrap.scrollTop;
      const pts = drawRef.current.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(x - last.x, y - last.y) < 1.5) return;
      pts.push({ x, y });
      redrawCanvas();
    },
    [mode, redrawCanvas]
  );

  const finalizeStroke = useCallback(() => {
    if (drawRef.current?.points?.length > 1) {
      setStrokes((prev) => [
        ...prev,
        { points: [...drawRef.current.points], color: 'rgba(126, 200, 255, 0.55)', width: 2.2 }
      ]);
    }
    drawRef.current = null;
    redrawCanvas();
  }, [redrawCanvas]);

  const endCanvasStroke = useCallback(
    (event) => {
      event.stopPropagation();
      finalizeStroke();
      if (event.pointerId != null) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [finalizeStroke]
  );

  const clearDrawings = useCallback(() => {
    setStrokes([]);
    drawRef.current = null;
    redrawCanvas();
  }, [redrawCanvas]);

  return (
    <div className="mindmap-shell">
      <div className="mindmap-toolbar">
        <p className="mindmap-hint">
          Mind map: «проект → колонки → задачи». Узлы перетаскиваются. «Рисовать» — слой freehand поверх схемы.
        </p>
        <div className="mindmap-toolbar-actions">
          <button type="button" className={mode === 'map' ? 'mindmap-mode active' : 'mindmap-mode'} onClick={() => setMode('map')}>
            Схема
          </button>
          <button type="button" className={mode === 'draw' ? 'mindmap-mode active' : 'mindmap-mode'} onClick={() => setMode('draw')}>
            Рисовать
          </button>
          <button type="button" className="ghost mindmap-clear" onClick={clearDrawings}>
            Стереть рисунки
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`mindmap-viewport ${mode === 'draw' ? 'draw-mode' : ''}`}
        onPointerMove={onViewportPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="mindmap-canvas-inner" style={{ width: contentSize.width, height: contentSize.height }}>
          <canvas
            ref={canvasRef}
            className="mindmap-freehand"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endCanvasStroke}
            onPointerCancel={endCanvasStroke}
          />
          <svg className="mindmap-edges" width={contentSize.width} height={contentSize.height} aria-hidden="true">
            {edges.map((e) => (
              <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            ))}
          </svg>
          {Object.entries(positions).map(([id, node]) => {
            if (node.kind === 'root') {
              return (
                <div
                  key={id}
                  role="presentation"
                  className="mindmap-node mindmap-node-root"
                  style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                  onPointerDown={(e) => onNodePointerDown(e, id)}
                >
                  {node.label}
                </div>
              );
            }
            if (node.kind === 'column') {
              return (
                <div
                  key={id}
                  role="presentation"
                  className="mindmap-node mindmap-node-column"
                  style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                  onPointerDown={(e) => onNodePointerDown(e, id)}
                >
                  {node.label}
                </div>
              );
            }
            if (node.kind === 'task') {
              const taskList = tasksByColumn[node.columnId] || [];
              const task = taskList.find((t) => t.id === id) || null;
              const done = task ? isTaskDone?.(task) : false;
              const overdue = task ? isTaskOverdue?.(task) : false;
              return (
                <button
                  key={id}
                  type="button"
                  className={`mindmap-node mindmap-node-task ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}
                  style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                  title={node.label}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onNodePointerDown(e, id);
                  }}
                >
                  <span className="mindmap-node-task-title">{node.label}</span>
                </button>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
