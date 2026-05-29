import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Folder, Home, Lock } from "lucide-react";

type Node = {
  segment: string;
  fullPath: string;
  urlPath: string | null;
  isLayout: boolean;
  isDynamic: boolean;
  isProtected: boolean;
  children: Node[];
};

function filenameToSegments(file: string): string[] {
  // "/src/routes/dashboard.services.tsx" -> ["dashboard","services"]
  const base = file.replace(/^.*\/routes\//, "").replace(/\.tsx?$/, "");
  if (base === "__root" || base === "index") return [];
  return base.split(".");
}

function buildTree(files: string[]): Node {
  const root: Node = {
    segment: "/",
    fullPath: "",
    urlPath: "/",
    isLayout: true,
    isDynamic: false,
    isProtected: false,
    children: [],
  };

  for (const file of files) {
    const segments = filenameToSegments(file);
    if (segments.length === 0) continue;
    let parent = root;
    let acc = "";
    segments.forEach((seg, i) => {
      acc = acc ? `${acc}.${seg}` : seg;
      let node = parent.children.find(c => c.segment === seg);
      if (!node) {
        const isLayout = seg.startsWith("_");
        const isDynamic = seg.startsWith("$");
        const visibleSegs = (acc.split(".")).filter(s => !s.startsWith("_"));
        const isIndex = seg === "index" && i === segments.length - 1;
        const urlSegs = isIndex ? visibleSegs.slice(0, -1) : visibleSegs;
        const urlPath = "/" + urlSegs.map(s => s.startsWith("$") ? `:${s.slice(1)}` : s).join("/");
        node = {
          segment: seg,
          fullPath: acc,
          urlPath: isLayout ? null : (urlPath === "/" ? "/" : urlPath.replace(/\/$/, "")),
          isLayout,
          isDynamic,
          isProtected: acc.split(".").some(s => s === "_authenticated" || s === "dashboard" || s === "admin"),
          children: [],
        };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  // sort: layouts first, then alpha
  const sortRec = (n: Node) => {
    n.children.sort((a, b) => {
      if (a.isLayout !== b.isLayout) return a.isLayout ? -1 : 1;
      return a.segment.localeCompare(b.segment);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function NodeRow({ node, depth, isLast, prefix }: { node: Node; depth: number; isLast: boolean; prefix: string }) {
  const connector = depth === 0 ? "" : (isLast ? "└─ " : "├─ ");
  const Icon = node.isLayout ? Folder : node.segment === "index" || node.fullPath === "" ? Home : FileText;
  const label = node.segment === "index" && depth === 0 ? "/" : node.segment;

  const url = node.urlPath && !node.urlPath.includes(":") ? node.urlPath : null;

  return (
    <div>
      <div className="flex items-center gap-2 font-mono text-sm py-1 hover:bg-muted/40 rounded px-1">
        <span className="text-muted-foreground whitespace-pre">{prefix}{connector}</span>
        <Icon className={`w-3.5 h-3.5 ${node.isLayout ? "text-primary" : "text-muted-foreground"}`} />
        {url ? (
          <Link to={url} className="text-foreground hover:text-primary hover:underline" target="_blank">
            {label}
          </Link>
        ) : (
          <span className={node.isLayout ? "text-primary font-medium" : ""}>{label}</span>
        )}
        {node.isDynamic && <Badge variant="outline" className="h-4 text-[10px] px-1">dinamikus</Badge>}
        {node.isLayout && <Badge variant="secondary" className="h-4 text-[10px] px-1">layout</Badge>}
        {node.isProtected && !node.isLayout && <Lock className="w-3 h-3 text-amber-600" />}
        {node.urlPath && <span className="text-xs text-muted-foreground ml-auto">{node.urlPath}</span>}
      </div>
      {node.children.map((c, i) => (
        <NodeRow
          key={c.fullPath}
          node={c}
          depth={depth + 1}
          isLast={i === node.children.length - 1}
          prefix={depth === 0 ? "" : prefix + (isLast ? "   " : "│  ")}
        />
      ))}
    </div>
  );
}

export function SiteMap() {
  // import.meta.glob runs at build/dev time and reflects the actual file tree.
  const files = useMemo(() => {
    const mods = import.meta.glob("/src/routes/**/*.tsx", { eager: false });
    return Object.keys(mods).filter(f => !f.endsWith("/__root.tsx"));
  }, []);
  const tree = useMemo(() => buildTree(files), [files]);

  const stats = useMemo(() => {
    let total = 0, layouts = 0, dynamic = 0;
    const walk = (n: Node) => {
      n.children.forEach(c => {
        total++;
        if (c.isLayout) layouts++;
        if (c.isDynamic) dynamic++;
        walk(c);
      });
    };
    walk(tree);
    return { total, layouts, dynamic, pages: total - layouts };
  }, [tree]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold">Weboldal térkép</h2>
          <p className="text-xs text-muted-foreground">
            Automatikusan frissül a `src/routes/` mappa alapján — minden új útvonal azonnal megjelenik.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Badge variant="secondary">{stats.pages} oldal</Badge>
          <Badge variant="outline">{stats.layouts} layout</Badge>
          {stats.dynamic > 0 && <Badge variant="outline">{stats.dynamic} dinamikus</Badge>}
        </div>
      </div>
      <div className="bg-muted/20 border rounded-md p-3 overflow-x-auto">
        <NodeRow node={tree} depth={0} isLast prefix="" />
      </div>
      <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-4">
        <span className="flex items-center gap-1"><Folder className="w-3 h-3 text-primary" /> layout / csoportosító</span>
        <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> oldal</span>
        <span className="flex items-center gap-1"><Lock className="w-3 h-3 text-amber-600" /> védett</span>
        <span className="flex items-center gap-1"><Badge variant="outline" className="h-4 text-[10px] px-1">dinamikus</Badge> URL paraméter</span>
      </div>
    </Card>
  );
}
