/* 导入 / 导出 / 备份（PRD F7） */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";
import { Dialog, useDialog, useToast, Switch } from "../components/feedback";
import { downloadCSV, downloadJSON, downloadTemplate, mapImportedTransactions, parseCSV, type ParsedRow } from "../lib/csv";
import { listSnapshots, readSnapshot, writeSnapshot, type SnapshotMeta } from "../lib/backup";
import { formatMoney } from "@daybook/shared";
import type { AppData } from "@daybook/shared";

interface CsvPreview {
  headers: string[];
  rows: ParsedRow[];
  failures: ParsedRow[];
}

export function ImportExportScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const dialog = useDialog();
  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [jsonPreview, setJsonPreview] = useState<{ data: AppData; name: string } | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);

  const reloadSnapshots = async () => setSnapshots(await listSnapshots());

  useEffect(() => {
    void reloadSnapshots();
  }, []);

  const totalRecords = useMemo(() => store.transactions.filter((t) => t.deletedAt === null).length, [store.transactions]);

  const handleCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCSV(text);
      const failures = parsed.rows.filter((r) => !r.ok);
      if (parsed.rows.length === 0 && failures.length === 0) {
        toast.show({ message: "没有解析到有效数据，请检查文件", tone: "err", duration: 3000 });
        return;
      }
      setPreview({ headers: parsed.headers, rows: parsed.rows, failures });
    };
    reader.onerror = () => toast.show({ message: "读取文件失败", tone: "err", duration: 3000 });
    reader.readAsText(file, "utf-8");
  };

  const handleJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? "")) as AppData;
        if (!data || typeof data !== "object" || !Array.isArray(data.transactions)) {
          toast.show({ message: "不是有效的备份文件", tone: "err", duration: 3000 });
          return;
        }
        setJsonPreview({ data, name: file.name });
      } catch {
        toast.show({ message: "JSON 解析失败", tone: "err", duration: 3000 });
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const confirmImport = () => {
    if (!preview) return;
    const mapped = mapImportedTransactions(store, preview.rows);
    let toInsert = mapped.toInsert;
    if (skipDuplicates) {
      toInsert = toInsert.filter((t) => {
        const dup = store.transactions.some(
          (x) => x.deletedAt === null && x.amount === t.amount && new Date(x.occurredAt).toDateString() === new Date(t.occurredAt).toDateString() && (x.note || "") === (t.note || ""),
        );
        return !dup;
      });
    }
    store.importTransactions(toInsert);
    const failed = mapped.failures.length;
    toast.show({
      message: `成功导入 ${toInsert.length} 条${failed ? `，失败 ${failed} 条` : ""}${mapped.unmatched ? `，${mapped.unmatched} 条分类未匹配已归入其他` : ""}`,
      tone: failed ? "info" : "ok",
      duration: 4000,
    });
    setPreview(null);
  };

  const okRows = preview?.rows.filter((r) => r.ok) ?? [];

  return (
    <SubPage title="导入 / 导出" subtitle={`当前 ${totalRecords} 条记录`} onBack={nav.pop}>
      {/* 导出 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">导出</div>
        </div>
        <div className="list">
          <button className="setting-row" onClick={() => { downloadCSV(store); toast.show({ message: "CSV 已导出", duration: 2500 }); }}>
            <span className="ic"><Icon name="download" size={18} /></span>
            <span className="tx"><b>导出 CSV</b><span>UTF-8 带 BOM，Excel 直接可读</span></span>
            <span className="chev"><Icon name="chevronRight" size={18} /></span>
          </button>
          <button className="setting-row" onClick={() => { downloadJSON(store); toast.show({ message: "JSON 备份已导出", duration: 2500 }); }}>
            <span className="ic"><Icon name="download" size={18} /></span>
            <span className="tx"><b>导出 JSON</b><span>含分类、账户、预算与设置的完整备份</span></span>
            <span className="chev"><Icon name="chevronRight" size={18} /></span>
          </button>
          <button className="setting-row" onClick={downloadTemplate}>
            <span className="ic"><Icon name="tag" size={18} /></span>
            <span className="tx"><b>下载导入模板</b><span>按模板填好后再导入，成功率更高</span></span>
            <span className="chev"><Icon name="chevronRight" size={18} /></span>
          </button>
        </div>
      </div>

      {/* 导入 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">导入</div>
        </div>
        <div className="list">
          <button className="setting-row" onClick={() => csvInput.current?.click()}>
            <span className="ic"><Icon name="upload" size={18} /></span>
            <span className="tx"><b>导入 CSV 流水</b><span>支持列名中英文容错，导入前可预览</span></span>
            <span className="chev"><Icon name="chevronRight" size={18} /></span>
          </button>
          <button className="setting-row" onClick={() => jsonInput.current?.click()}>
            <span className="ic"><Icon name="refresh" size={18} /></span>
            <span className="tx"><b>从 JSON 备份恢复</b><span>校验 schema 版本后整体替换数据</span></span>
            <span className="chev"><Icon name="chevronRight" size={18} /></span>
          </button>
        </div>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && handleJson(e.target.files[0])} />
      </div>

      {/* 自动备份 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">本地自动备份</div>
          <button className="link-btn" onClick={() => { void (async () => { await writeSnapshot(store); await reloadSnapshots(); toast.show({ message: "已生成本地快照", duration: 2000 }); })(); }}>
            立即备份
          </button>
        </div>
        {snapshots.length === 0 ? (
          <div className="card xsmall muted-2">尚无快照。每日首次打开会自动生成，最多保留 7 份。</div>
        ) : (
          <div className="list">
            {snapshots.map((s) => (
              <div key={s.date} className="setting-row">
                <span className="ic"><Icon name="clock" size={18} /></span>
                <span className="tx"><b>{s.date}</b><span>{s.records} 条 · {(s.size / 1024).toFixed(0)} KB</span></span>
                <button
                  className="btn-round-sm"
                  onClick={() =>
                    dialog.confirm({
                      title: `恢复到 ${s.date} 的快照？`,
                      description: "当前数据将被该快照整体替换。",
                      confirmLabel: "恢复",
                      onConfirm: () => {
                        void (async () => {
                          const data = await readSnapshot(s.date);
                          if (!data) {
                            toast.show({ message: "快照已损坏", tone: "err", duration: 2500 });
                            return;
                          }
                          const err = store.replaceAll(data);
                          toast.show({ message: err ?? "已恢复", tone: err ? "err" : "ok", duration: 3000 });
                        })();
                      },
                    })
                  }
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="xsmall muted-2" style={{ marginTop: 16, lineHeight: 1.8 }}>
        · 导出文件命名：DayBook-YYYY-MM-DD-HHmm.csv<br />
        · 导入时同日期 + 同金额 + 同备注视为疑似重复
      </div>

      {/* CSV 预览 */}
      {preview ? (
        <div className="sheet-backdrop" onClick={() => setPreview(null)}>
          <div className="sheet" style={{ maxHeight: "88%" }} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="between" style={{ padding: "4px 20px 8px" }}>
              <div className="sheet-title">导入预览</div>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="关闭"><Icon name="close" size={20} /></button>
            </div>
            <div className="sheet-body">
              <div className="stat-grid" style={{ marginBottom: 12 }}>
                <div className="stat"><span>可导入</span><b className="smaller" style={{ color: "var(--income)" }}>{okRows.length}</b></div>
                <div className="stat"><span>异常行</span><b className="smaller" style={{ color: preview.failures.length ? "var(--budget-over)" : "var(--t1)" }}>{preview.failures.length}</b></div>
                <div className="stat"><span>总行数</span><b className="smaller">{preview.rows.length}</b></div>
              </div>

              <div className="between" style={{ marginBottom: 10 }}>
                <span className="small" style={{ fontWeight: 600 }}>跳过疑似重复</span>
                <Switch on={skipDuplicates} onChange={setSkipDuplicates} label="跳过疑似重复" />
              </div>

              <div className="xsmall muted-2" style={{ marginBottom: 6 }}>前 10 行预览</div>
              <div className="list" style={{ marginBottom: 12 }}>
                {okRows.slice(0, 10).map((r) => (
                  <div key={r.index} className="setting-row">
                    <span className="ic"><Icon name="tag" size={16} /></span>
                    <span className="tx">
                      <b>{r.data?.parentName}{r.data?.childName ? ` · ${r.data.childName}` : ""}</b>
                      <span>{r.data ? new Date(r.data.occurredAt).toLocaleDateString("zh-CN") : ""} · {r.data?.accountName}{r.data?.note ? ` · ${r.data.note}` : ""}</span>
                    </span>
                    <span className="amt num" style={{ color: r.data?.type === "income" ? "var(--income)" : "var(--expense)" }}>{formatMoney(r.data?.amount ?? 0)}</span>
                  </div>
                ))}
              </div>

              {preview.failures.length > 0 ? (
                <>
                  <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 6, fontWeight: 600 }}>失败行与原因</div>
                  <div className="list" style={{ marginBottom: 12 }}>
                    {preview.failures.slice(0, 20).map((f) => (
                      <div key={f.index} className="setting-row">
                        <span className="ic" style={{ background: "var(--budget-over-bg)", color: "var(--budget-over)" }}><Icon name="info" size={16} /></span>
                        <span className="tx"><b>第 {f.index} 行</b><span>{f.error}</span></span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <button className="btn btn-main btn-block" onClick={confirmImport} disabled={okRows.length === 0}>
                导入 {okRows.length} 条
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* JSON 恢复预览 */}
      {jsonPreview ? (
        <div className="sheet-backdrop" onClick={() => setJsonPreview(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div style={{ padding: "4px 20px 12px" }} className="sheet-title">恢复预览</div>
            <div className="sheet-body">
              <div className="card tight" style={{ marginBottom: 12 }}>
                <div className="between xsmall"><span className="muted-2">文件</span><span>{jsonPreview.name}</span></div>
                <div className="divider" style={{ margin: "10px 0" }} />
                <div className="between xsmall"><span className="muted-2">记录数</span><span className="num">{jsonPreview.data.transactions.length}</span></div>
                <div className="between xsmall" style={{ marginTop: 6 }}><span className="muted-2">分类 / 账户</span><span className="num">{jsonPreview.data.categories?.length ?? 0} / {jsonPreview.data.accounts?.length ?? 0}</span></div>
                {jsonPreview.data.transactions.length > 0 ? (
                  <div className="between xsmall" style={{ marginTop: 6 }}>
                    <span className="muted-2">时间范围</span>
                    <span className="num">
                      {new Date(Math.min(...jsonPreview.data.transactions.map((t) => t.occurredAt))).toLocaleDateString("zh-CN")} ~ {new Date(Math.max(...jsonPreview.data.transactions.map((t) => t.occurredAt))).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="xsmall muted-2" style={{ marginBottom: 14, lineHeight: 1.7 }}>
                确认后将先为当前数据生成一份本地快照，再用备份整体替换。
              </div>
              <button
                className="btn btn-main btn-block"
                onClick={() => {
                  void (async () => {
                    await writeSnapshot(store);
                    const err = store.replaceAll(jsonPreview.data);
                    toast.show({ message: err ?? "已从备份恢复", tone: err ? "err" : "ok", duration: 3000 });
                    setJsonPreview(null);
                    await reloadSnapshots();
                  })();
                }}
              >
                确认恢复
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog state={dialog.state} onClose={dialog.close} />
    </SubPage>
  );
}