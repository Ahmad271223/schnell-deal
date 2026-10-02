'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatEuro } from '@/lib/format';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y?.slice(2)}`;
};

const COLORS = ['#1f55c9', '#0f9f6e', '#d97706', '#7c3aed', '#dc2626'];

export function BarSeries({ data, bars, height = 260, money }: { data: Record<string, unknown>[]; bars: { key: string; label: string }[]; height?: number; money?: boolean }) {
  return (
    <div style={{ height }} role="img" aria-label={`Balkendiagramm: ${bars.map((b) => b.label).join(', ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickFormatter={money ? (v: number) => `${Math.round(v / 100000)}k` : undefined} />
          <Tooltip formatter={(v) => (money ? formatEuro(Number(v)) : String(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} name={b.label} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineSeries({ data, lines, height = 260, money, percent }: { data: Record<string, unknown>[]; lines: { key: string; label: string }[]; height?: number; money?: boolean; percent?: boolean }) {
  return (
    <div style={{ height }} role="img" aria-label={`Liniendiagramm: ${lines.map((b) => b.label).join(', ')}`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} domain={percent ? [0, 100] : undefined} tickFormatter={money ? (v: number) => `${Math.round(v / 100)} €` : percent ? (v: number) => `${v} %` : undefined} width={money ? 70 : 40} />
          <Tooltip formatter={(v) => (v === null || v === undefined ? '–' : money ? formatEuro(Number(v)) : percent ? `${v} %` : String(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l, i) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
