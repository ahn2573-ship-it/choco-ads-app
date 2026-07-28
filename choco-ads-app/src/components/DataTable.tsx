import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, EmptyState, Pagination, TableSkeleton } from "@/components/ui";

export interface Column<T> {
  key: string;
  header: string;
  /** 정렬·엑셀용 원시 값 */
  value: (row: T) => string | number | null;
  /** 화면 표시. 없으면 value 를 그대로 쓴다. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** 기본 숨김 컬럼 */
  hidden?: boolean;
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  toolbar?: ReactNode;
}

export function DataTable<T>({
  columns, rows, loading, emptyTitle = "표시할 데이터가 없습니다",
  emptyDescription, rowKey, onRowClick, pageSize = 50, defaultSort, toolbar,
}: Props<T>) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0].key, dir: "desc" as const });
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.hidden).map((c) => c.key)),
  );
  const [showPicker, setShowPicker] = useState(false);

  const visible = columns.filter((c) => !hidden.has(c.key));

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), "ko") * factor;
    });
  }, [rows, sort, columns]);

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(key: string) {
    setSort((s) => s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "desc" });
    setPage(0);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {toolbar}
        <div className="relative ml-auto">
          <Button size="sm" variant="ghost" onClick={() => setShowPicker((v) => !v)}>
            <Columns3 className="h-3.5 w-3.5" /> 컬럼
          </Button>
          {showPicker && (
            <div className="absolute right-0 top-9 z-20 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
              {columns.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-sunken"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => setHidden((h) => {
                      const next = new Set(h);
                      next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                      return next;
                    })}
                  />
                  {c.header}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <TableSkeleton cols={Math.min(visible.length, 8)} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {visible.map((c) => (
                    <th
                      key={c.key}
                      className={cn("th cursor-pointer select-none",
                        c.align === "right" && "text-right")}
                      style={c.width ? { width: c.width } : undefined}
                      onClick={() => toggleSort(c.key)}
                    >
                      <span className={cn("inline-flex items-center gap-1",
                        c.align === "right" && "flex-row-reverse")}>
                        {c.header}
                        {sort.key === c.key && (sort.dir === "asc"
                          ? <ArrowUp className="h-3 w-3" />
                          : <ArrowDown className="h-3 w-3" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={cn("row-hover", onRowClick && "cursor-pointer")}
                    onClick={() => onRowClick?.(row)}
                  >
                    {visible.map((c) => (
                      <td key={c.key} className={cn("td", c.align === "right" && "text-right")}>
                        {c.render ? c.render(row) : c.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page} pageSize={pageSize} total={sorted.length}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
