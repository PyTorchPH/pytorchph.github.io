"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { activityTrend, barSkills, departmentLoad, skillRadar } from "@pytorch-ph/domain-client/organization";
import type { AnalyticsState } from "@pytorch-ph/domain-protocol/career-evidence";
import { ChartContainer } from "@pytorch-ph/design-system/chart";

const chartConfig = { primary: { label: "Primary series", color: "var(--accent)" }, secondary: { label: "Secondary series", color: "var(--info)" } };

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--ink)"
};

function Watermark({ state }: { state?: AnalyticsState }) {
  if (state !== "unavailable") return null;
  return <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><span className="border border-border bg-canvas/85 px-5 py-2 font-mono text-xs uppercase tracking-[0.18em] text-muted shadow-xl">Data unavailable</span></div>;
}

const emptySkills = ["Computer Vision", "NLP", "Optimization", "MLOps", "Data Ethics", "Research"].map((skill) => ({ skill, score: 0 }));
const emptyActivity = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({ day, events: null, contributions: null }));
const emptyDepartments = ["Learning Programs", "Engineering", "External", "Research", "Creatives"].map((department) => ({ department, open: null, approved: null }));

export function SkillRadarChart({ data = skillRadar, state }: { data?: Array<{ skill: string; score: number | null }>; state?: AnalyticsState } = {}) {
  const chartData = data.length ? data : emptySkills;
  return (
    <ChartContainer aria-label="Skill readiness radar chart" className="h-72" config={chartConfig}>
      <Watermark state={state} />
      <ResponsiveContainer>
        <RadarChart accessibilityLayer data={chartData}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="skill" tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <Radar dataKey="score" fill="var(--accent)" fillOpacity={0.28} stroke="var(--accent)" strokeWidth={2} />
          <Tooltip contentStyle={tooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function SkillBarChart() {
  return (
    <ChartContainer aria-label="Skill score bar chart" className="h-64" config={chartConfig}>
      <ResponsiveContainer>
        <BarChart accessibilityLayer data={barSkills}>
          <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="value" fill="var(--accent)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function PersonalActivityChart({ data }: { data: Array<{ week: string; points: number }> }) {
  return <ChartContainer aria-label="Twelve-week verified point activity" className="h-64" config={chartConfig}><ResponsiveContainer><AreaChart accessibilityLayer data={data}><defs><linearGradient id="personal-activity" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--accent)" stopOpacity={0.42} /><stop offset="95%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="week" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} /><Area dataKey="points" fill="url(#personal-activity)" stroke="var(--accent)" strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer></ChartContainer>;
}

export function SkillPointsChart({ data }: { data: Array<{ skill: string; points: number }> }) {
  return <ChartContainer aria-label="Verified skill points" className="h-64" config={chartConfig}><ResponsiveContainer><BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 12 }}><CartesianGrid horizontal={false} stroke="var(--chart-grid)" /><XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis dataKey="skill" type="category" width={76} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="points" fill="var(--accent)" radius={[0,6,6,0]} /></BarChart></ResponsiveContainer></ChartContainer>;
}

export function ActivityTrendChart({ data = activityTrend, state }: { data?: Array<{ day: string; events: number | null; contributions: number | null }>; state?: AnalyticsState } = {}) {
  const chartData = data.length ? data : emptyActivity;
  return (
    <ChartContainer aria-label="Weekly activity trend chart" className="h-72" config={chartConfig}>
      <Watermark state={state} />
      <ResponsiveContainer>
        <AreaChart accessibilityLayer data={chartData}>
          <defs>
            <linearGradient id="activity-orange" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.42} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area dataKey="contributions" fill="url(#activity-orange)" stroke="var(--accent)" strokeWidth={2} type="monotone" />
          <Line dataKey="events" dot={false} stroke="var(--info)" strokeWidth={2} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function DepartmentLoadChart({ data = departmentLoad, state }: { data?: Array<{ department: string; open: number | null; approved: number | null }>; state?: AnalyticsState } = {}) {
  const chartData = data.length ? data : emptyDepartments;
  return (
    <ChartContainer aria-label="Department workload chart" className="h-64" config={chartConfig}>
      <Watermark state={state} />
      <ResponsiveContainer>
        <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis tick={{ fill: "var(--muted)", fontSize: 12 }} type="number" />
          <YAxis dataKey="department" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} type="category" width={86} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="open" fill="var(--accent)" radius={[0, 6, 6, 0]} />
          <Bar dataKey="approved" fill="var(--border)" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

const readinessColors = ["var(--accent)", "var(--warning)", "var(--info)", "var(--success)"];

export function CareerReadinessDonut({ segments }: { segments: Array<{ label: string; ready: boolean }> }) {
  const ready = segments.filter((item) => item.ready).length;
  const data = segments.map((item) => ({ name: item.label, value: 1, ready: item.ready }));
  return <ChartContainer aria-label="Career readiness donut chart" className="h-64" config={chartConfig}>
    <ResponsiveContainer><PieChart accessibilityLayer><Pie data={data} dataKey="value" innerRadius={68} outerRadius={92} paddingAngle={3} stroke="transparent">{data.map((item, index) => <Cell fill={item.ready ? readinessColors[index % readinessColors.length] : "var(--chart-grid)"} key={item.name} />)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={(_value, _name, entry) => [entry.payload.ready ? "Ready" : "Needs prerequisite", entry.payload.name]} /></PieChart></ResponsiveContainer>
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="data-label text-3xl font-bold">{ready}/{segments.length}</span><span className="mt-1 text-xs text-muted">ready</span></div>
  </ChartContainer>;
}
