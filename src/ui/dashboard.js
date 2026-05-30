import React from 'react';
import { render, Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';

export async function showDecisionDashboard({ report, aiAnalysis }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return report.decision === 'pass' ? 'commit' : 'abort';
  }

  return new Promise((resolve) => {
    const instance = render(
      React.createElement(Dashboard, {
        report,
        aiAnalysis,
        onDecision: (decision) => {
          resolve(decision);
          instance.unmount();
        }
      })
    );
  });
}

function Dashboard({ report, aiAnalysis, onDecision }) {
  const app = useApp();
  const shouldReview = report.decision !== 'pass';
  const riskColor = colorForRiskScore(aiAnalysis.riskScore);
  const securityFindings = report.securityFindings ?? [];
  const divergences = report.sandbox?.divergences ?? [];
  const metricWarnings = (report.modifiedFunctions ?? []).filter((fn) => fn.metrics?.isOverThreshold);
  const items = [
    {
      label: shouldReview ? 'ABORT COMMIT (Recommended)' : 'COMMIT',
      value: shouldReview ? 'abort' : 'commit'
    },
    {
      label: shouldReview ? 'COMMIT ANYWAY' : 'ABORT',
      value: shouldReview ? 'commit' : 'abort'
    }
  ];

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    React.createElement(Text, { color: shouldReview ? 'yellow' : 'green', bold: true }, 'BTM DevSecOps Dashboard'),
    React.createElement(Text, { color: 'gray' }, '────────────────────────────────────────────────────────────'),
    React.createElement(Text, null, `Audit: ${report.auditEnabled ? 'ENABLED' : 'disabled'}    Metrics: ${report.metricsEnabled ? 'ENABLED' : 'disabled'}`),
    React.createElement(
      Text,
      null,
      'Risk Oracle: ',
      React.createElement(Text, { color: riskColor, bold: true }, `${aiAnalysis.riskScore}/100`),
      ` (${aiAnalysis.category})`
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { bold: true }, 'Risk Tree'),
    React.createElement(Text, null, `├─ Security: ${securityFindings.length === 0 ? 'OK' : `${securityFindings.length} finding(s)`}`),
    ...securityFindings.slice(0, 4).map((finding) =>
      React.createElement(Text, { key: `${finding.ruleId}-${finding.line}`, color: colorForSeverity(finding.severity) }, `│  ├─ [${finding.severity.toUpperCase()}] ${finding.message}`)
    ),
    React.createElement(Text, null, `├─ Behavior: ${divergences.length === 0 ? 'OK' : `${divergences.length} divergence(s)`}`),
    ...divergences.slice(0, 4).map((divergence) =>
      React.createElement(Text, { key: `${divergence.functionId}-${divergence.type}`, color: colorForSeverity(divergence.severity) }, `│  ├─ [${divergence.severity.toUpperCase()}] ${divergence.message}`)
    ),
    React.createElement(Text, null, `└─ Metrics: ${metricWarnings.length === 0 ? 'OK' : `${metricWarnings.length} warning(s)`}`),
    ...metricWarnings.slice(0, 4).map((fn) =>
      React.createElement(Text, { key: fn.id, color: 'yellow' }, `   ├─ [MEDIUM] ${fn.name} complexity ${fn.metrics.cyclomaticComplexity}`)
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { bold: true }, 'Diagnosis'),
    React.createElement(Text, null, `Root Cause: ${aiAnalysis.rootCause}`),
    React.createElement(Text, null, `Fix: ${aiAnalysis.fixSuggestion}`),
    React.createElement(Text, null, ''),
    React.createElement(Text, { bold: true }, 'AI Recommendations:'),
    ...aiAnalysis.options.map((option) =>
      React.createElement(Text, { key: `${option.label}-${option.kind}` }, `- ${option.label} (${option.kind}): ${option.recommendation}`)
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: shouldReview ? 'yellow' : 'cyan', bold: true }, 'Proceed with commit?'),
    React.createElement(SelectInput, {
      items,
      onSelect: (item) => {
        onDecision(item.value);
        app.exit();
      }
    })
  );
}

function colorForRiskScore(score) {
  if (score >= 70) {
    return 'red';
  }

  if (score >= 30) {
    return 'yellow';
  }

  return 'green';
}

function colorForSeverity(severity) {
  if (severity === 'critical' || severity === 'high') {
    return 'red';
  }

  if (severity === 'medium') {
    return 'yellow';
  }

  return 'cyan';
}
