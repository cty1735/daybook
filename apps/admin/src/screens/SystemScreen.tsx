/* 系统信息：版本、运行时长、各表行数 */

import { api } from "../lib/api";
import { dt, uptime } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function SystemScreen() {
  const { data, loading, error } = useAsync(() => api.system(), []);

  if (loading) return <div className="loading">加载中…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const s = data.data;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">系统信息</div>
          <div className="page-desc">服务版本、运行时长与数据规模</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-k">版本</div>
          <div className="stat-v small">{s.version}</div>
          <div className="stat-sub">{s.nodeEnv}</div>
        </div>
        <div className="stat">
          <div className="stat-k">运行时长</div>
          <div className="stat-v small">{uptime(s.uptimeSec)}</div>
          <div className="stat-sub">{s.uptimeSec} 秒</div>
        </div>
        <div className="stat">
          <div className="stat-k">最近一次后台操作</div>
          <div className="stat-v small" style={{ fontSize: 15 }}>
            {s.lastAuditAt ? dt(s.lastAuditAt) : "暂无"}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>数据表</th>
              <th style={{ textAlign: "right" }}>行数</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.tables).map(([name, n]) => (
              <tr key={name}>
                <td className="num" style={{ fontSize: 12.5 }}>{name}</td>
                <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
