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
    { flexDirection: 'column', paddingX: 1 },
    React.createElement(Text, { color: shouldReview ? 'yellow' : 'green', bold: true }, 'BTM Core Pipeline Triggered.'),
    React.createElement(Text, null, `Security Audit Mode: ${report.auditEnabled ? 'ENABLED' : 'disabled'}`),
    React.createElement(Text, null, `Code Metrics Mode: ${report.metricsEnabled ? 'ENABLED' : 'disabled'}`),
    React.createElement(Text, null, `Risk Oracle Score: ${aiAnalysis.riskScore}/100 (${aiAnalysis.category})`),
    React.createElement(Text, null, `Root Cause: ${aiAnalysis.rootCause}`),
    React.createElement(Text, null, `Fix: ${aiAnalysis.fixSuggestion}`),
    React.createElement(Text, null, ''),
    React.createElement(Text, { bold: true }, 'AI Recommendations:'),
    ...aiAnalysis.options.map((option) =>
      React.createElement(Text, { key: `${option.label}-${option.kind}` }, `- ${option.label} (${option.kind}): ${option.recommendation}`)
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: 'cyan' }, 'Proceed with commit?'),
    React.createElement(SelectInput, {
      items,
      onSelect: (item) => {
        onDecision(item.value);
        app.exit();
      }
    })
  );
}
