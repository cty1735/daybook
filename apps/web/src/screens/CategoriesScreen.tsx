/* 分类管理（PRD F2） */

import { useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";
import { Sheet, Dialog, useDialog, useToast } from "../components/feedback";
import { CATEGORY_PALETTE } from "@daybook/shared";
import { childrenOf, sortByUsage } from "../lib/select";
import type { Category, CategoryKind } from "@daybook/shared";

const ICON_CHOICES = [
  "food", "coffee", "candy", "users", "car", "train", "fuel", "parking", "plane", "bag", "shirt", "device",
  "beauty", "sofa", "home", "bolt", "wrench", "phone", "film", "gamepad", "dumbbell", "pill", "book", "gift",
  "envelope", "bed", "ticket", "paw", "tag", "briefcase", "coin", "trendUp", "undo", "card", "refresh", "sparkles",
];

interface Draft {
  id?: string;
  parentId: string | null;
  name: string;
  icon: string;
  color: string;
  noteTemplate: string;
  kind: CategoryKind;
}

export function CategoriesScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const dialog = useDialog();

  const [kind, setKind] = useState<CategoryKind>("expense");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [colorPickOpen, setColorPickOpen] = useState(false);

  const parents = useMemo(
    () => sortByUsage(store.categories.filter((c) => !c.parentId && c.kind === kind), store.categoryUsage),
    [store.categories, store.categoryUsage, kind],
  );

  const usedColors = useMemo(() => new Set(store.categories.filter((c) => !c.parentId).map((c) => c.color)), [store.categories]);

  const nextFreeColor = () => CATEGORY_PALETTE.find((c) => !usedColors.has(c)) ?? CATEGORY_PALETTE[0];

  const expenseParentCount = store.categories.filter((c) => !c.parentId && c.kind === "expense").length;

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.show({ message: "请填写分类名称", tone: "err", duration: 2500 });
      return;
    }
    if (draft.id) {
      store.updateCategory(draft.id, {
        name: draft.name.trim(),
        icon: draft.icon,
        color: draft.color,
        noteTemplate: draft.noteTemplate,
      });
      toast.show({ message: "分类已更新", duration: 2000 });
    } else {
      store.addCategory({
        parentId: draft.parentId,
        name: draft.name.trim(),
        kind: draft.kind,
        icon: draft.icon,
        color: draft.color,
        isHidden: false,
        noteTemplate: draft.noteTemplate,
      });
      toast.show({ message: "分类已创建", duration: 2000 });
    }
    setDraft(null);
  };

  const countRecords = (cat: Category) => {
    const ids = new Set([cat.id, ...childrenOf(store.categories, cat.id).map((c) => c.id)]);
    return store.transactions.filter((t) => t.deletedAt === null && t.categoryId && ids.has(t.categoryId)).length;
  };

  return (
    <SubPage
      title="分类管理"
      subtitle={kind === "expense" ? `${expenseParentCount}/20 个一级分类` : "收入分类"}
      onBack={nav.pop}
      action={
        <button
          className="icon-btn"
          aria-label="新建一级分类"
          onClick={() => {
            if (kind === "expense" && expenseParentCount >= 20) {
              toast.show({ message: "一级分类最多 20 个", tone: "err", duration: 2500 });
              return;
            }
            setDraft({ parentId: null, name: "", icon: "tag", color: nextFreeColor(), noteTemplate: "", kind });
          }}
        >
          <Icon name="plus" size={20} />
        </button>
      }
    >
      <div className="pill-tabs" style={{ marginBottom: 14, width: "100%" }}>
        <button className={kind === "expense" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setKind("expense"); setExpanded(null); }}>
          支出分类
        </button>
        <button className={kind === "income" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setKind("income"); setExpanded(null); }}>
          收入分类
        </button>
      </div>

      <div className="list">
        {parents.map((p) => {
          const kids = childrenOf(store.categories, p.id);
          const open = expanded === p.id;
          return (
            <div key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <button
                className="row"
                style={{ borderBottom: "none" }}
                onClick={() => setExpanded(open ? null : p.id)}
              >
                <span className="ic" style={{ background: "color-mix(in srgb, " + p.color + " 16%, var(--bg-card))", color: p.color }}>
                  <Icon name={p.icon} size={20} />
                </span>
                <span className="tx">
                  <b>
                    {p.name}
                    {p.isHidden ? <span className="xsmall muted-2">（已隐藏）</span> : null}
                  </b>
                  <span>{kids.length} 个二级分类 · {countRecords(p)} 条记录</span>
                </span>
                <span className="chev" style={{ color: "var(--t3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>
                  <Icon name="chevronRight" size={18} />
                </span>
              </button>

              {open ? (
                <div style={{ padding: "0 16px 14px", background: "var(--bg-sunken)" }}>
                  <div className="row-flex" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <button className="btn-round-sm" onClick={() => setDraft({ id: p.id, parentId: null, name: p.name, icon: p.icon, color: p.color, noteTemplate: p.noteTemplate, kind: p.kind })}>
                      编辑
                    </button>
                    <button className="btn-round-sm" onClick={() => { store.updateCategory(p.id, { isHidden: !p.isHidden }); toast.show({ message: p.isHidden ? "已显示" : "已隐藏", duration: 1800 }); }}>
                      {p.isHidden ? "显示" : "隐藏"}
                    </button>
                    <button className="btn-round-sm" onClick={() => setDraft({ parentId: p.id, name: "", icon: p.icon, color: p.color, noteTemplate: "", kind: p.kind })}>
                      + 二级
                    </button>
                    <button
                      className="btn-round-sm"
                      style={{ color: "var(--budget-over)", marginLeft: "auto" }}
                      onClick={() => {
                        const n = countRecords(p);
                        dialog.confirm({
                          title: `删除「${p.name}」及其二级分类？`,
                          description: n > 0 ? `${n} 条记录将归入上级分类（顶层分类的记录会变为「未分类」）。` : "该分类下暂无记录。",
                          confirmLabel: "删除",
                          tone: "danger",
                          onConfirm: () => {
                            const r = store.deleteCategory(p.id);
                            toast.show({ message: `已删除，${r.moved} 条记录已迁移`, duration: 2500 });
                            setExpanded(null);
                          },
                        });
                      }}
                    >
                      删除
                    </button>
                  </div>
                  <div className="chips" style={{ flexWrap: "wrap" }}>
                    {kids.map((c) => (
                      <button
                        key={c.id}
                        className="chip"
                        onClick={() => setDraft({ id: c.id, parentId: c.parentId, name: c.name, icon: c.icon, color: c.color, noteTemplate: c.noteTemplate, kind: c.kind })}
                        title="点击编辑"
                      >
                        <Icon name={c.icon} size={13} />
                        {c.name}
                      </button>
                    ))}
                    {kids.length === 0 ? <span className="xsmall muted-2">暂无二级分类</span> : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="xsmall muted-2" style={{ marginTop: 14, lineHeight: 1.8 }}>
        · 一级分类最多 20 个，不可删除但可隐藏<br />
        · 新建分类自动分配未占用的分类色（12 色色盲友好）<br />
        · 删除二级分类时，其记录会归入上级分类
      </div>

      {/* 编辑 / 新建 */}
      <Sheet open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? "编辑分类" : draft?.parentId ? "新建二级分类" : "新建一级分类"}>
        {draft ? (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>名称</label>
              <input className="input" value={draft.name} placeholder="分类名称" maxLength={8} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>图标</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                {ICON_CHOICES.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setDraft({ ...draft, icon: ic })}
                    style={{
                      height: 44,
                      borderRadius: 14,
                      display: "grid",
                      placeItems: "center",
                      background: draft.icon === ic ? "var(--green-500)" : "var(--green-50)",
                      color: draft.icon === ic ? "#fff" : "var(--t2)",
                    }}
                    aria-label={ic}
                  >
                    <Icon name={ic} size={20} />
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>颜色</label>
              <button className="row-flex" style={{ gap: 10 }} onClick={() => setColorPickOpen((v) => !v)}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: draft.color }} />
                <span className="small muted">{draft.color}</span>
                <Icon name={colorPickOpen ? "chevronUp" : "chevronDown"} size={16} />
              </button>
              {colorPickOpen ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginTop: 10 }}>
                  {CATEGORY_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setDraft({ ...draft, color: c }); setColorPickOpen(false); }}
                      style={{ height: 40, borderRadius: 12, background: c, outline: draft.color === c ? "2px solid var(--t1)" : "none", outlineOffset: 2 }}
                      aria-label={c}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>常用备注模板（可选）</label>
              <input className="input" value={draft.noteTemplate} placeholder="选中分类时一键填入" maxLength={20} onChange={(e) => setDraft({ ...draft, noteTemplate: e.target.value })} />
            </div>
            <button className="btn btn-main btn-block" onClick={saveDraft}>
              保存
            </button>
            {draft.id ? (
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 8, color: "var(--budget-over)" }}
                onClick={() => {
                  const cat = store.categories.find((c) => c.id === draft.id);
                  if (!cat) return;
                  const n = countRecords(cat);
                  const target = store.categories.find((c) => c.id === cat.parentId) ?? cat;
                  dialog.confirm({
                    title: `删除「${cat.name}」？`,
                    description: n > 0 ? `${n} 条记录将归入「${target.name}」。` : "该分类下暂无记录。",
                    confirmLabel: "删除",
                    tone: "danger",
                    onConfirm: () => {
                      const r = store.deleteCategory(cat.id);
                      toast.show({ message: `已删除，${r.moved} 条记录已迁移`, duration: 2500 });
                      setDraft(null);
                    },
                  });
                }}
              >
                删除该分类
              </button>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Dialog state={dialog.state} onClose={dialog.close} />
    </SubPage>
  );
}