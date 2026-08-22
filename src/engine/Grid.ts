import type { ShapeBox } from '../core/shapes';

const CELL = 512;

export class Grid {
  private boxes = new Map<string, ShapeBox>();
  private cells = new Map<string, Set<string>>();

  upsert(id: string, box: ShapeBox): void {
    this.remove(id);
    this.boxes.set(id, box);
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cx + ':' + cy;
        let set = this.cells.get(key);
        if (!set) {
          set = new Set();
          this.cells.set(key, set);
        }
        set.add(id);
      }
    }
  }

  remove(id: string): void {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(cx + ':' + cy);
        if (set) {
          set.delete(id);
          if (!set.size) this.cells.delete(cx + ':' + cy);
        }
      }
    }
  }

  rebuild(shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>): void {
    this.boxes.clear();
    this.cells.clear();
    for (const shape of shapes) {
      this.boxes.set(shape.id, shape);
    }
    for (const [id, box] of this.boxes) {
      const x0 = Math.floor(box.x / CELL);
      const x1 = Math.floor((box.x + box.w) / CELL);
      const y0 = Math.floor(box.y / CELL);
      const y1 = Math.floor((box.y + box.h) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx + ':' + cy;
          let set = this.cells.get(key);
          if (!set) {
            set = new Set();
            this.cells.set(key, set);
          }
          set.add(id);
        }
      }
    }
  }

  query(box: ShapeBox): Set<string> {
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    const result = new Set<string>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(cx + ':' + cy);
        if (!set) continue;
        for (const id of set) result.add(id);
      }
    }
    return result;
  }
}
