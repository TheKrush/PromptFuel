// Webview script for PromptFuel. Keep values interpolated into innerHTML escaped with esc()/escAttr().

(function() {
  var vscode = acquireVsCodeApi();
  var currentClaudeHistoryRange = '1M';
  var currentCodexHistoryRange = '1M';
  var currentCombinedHistoryRange = '1M';
  var lastUsageDetails = null;
  var lastUsageDashboardModel = null;
  var currentUsageProviderTab = 'overview';
  var historyTooltipPayloads = {};
  var historyTooltipIdCounter = 0;
  var modelTooltipIdCounter = 0;
  var HISTORY_TOOLTIP_MODEL_LIMIT = 12;
  var historyTooltipEl = null;
  var historyTooltipAnchor = null;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function activateProviderTab(providerTab) {
    if (currentUsageProviderTab === providerTab) {
      return;
    }
    currentUsageProviderTab = providerTab;

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    if (!tabs.length) {
      return;
    }

    tabs.forEach(function(t) {
      var tProvider = t.getAttribute('data-provider-tab');
      if (tProvider) {
        var active = tProvider === providerTab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      } else {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      }
    });

    Array.prototype.slice.call(document.querySelectorAll('.tab-panel')).forEach(function(panel) {
      panel.classList.toggle('active', panel.id === 'tab-usage');
    });

    if (lastUsageDashboardModel) {
      renderUsageDashboardSections(lastUsageDashboardModel);
    }
  }

  function setupTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    if (!tabs.length) {
      return;
    }

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var providerTab = tab.getAttribute('data-provider-tab');
        if (providerTab) {
          activateProviderTab(providerTab);
        }
      });
    });
  }

  function setUsageRefreshStatus(text) {
    var status = byId('usageRefreshStatus');
    if (status) {
      status.textContent = text;
    }
  }

  function requestUsageRefresh() {
    setUsageRefreshStatus('Refreshing usage…');
    setUsageLoading(true);
    vscode.postMessage({ command: 'refreshUsage' });
  }

  function setUsageLoading(isLoading) {
    var dashboard = document.querySelector('.usage-dashboard');
    if (!dashboard) {
      return;
    }
    if (isLoading) {
      dashboard.classList.add('loading');
    } else {
      dashboard.classList.remove('loading');
    }
  }

  function renderUsageDetails(details, today, providers) {
    var el = byId('usageDetails');
    if (!el) {
      return;
    }

    if (!details) {
      el.innerHTML = '<div class="usage-empty">Details are unavailable.</div>';
      lastUsageDetails = null;
      return;
    }

    lastUsageDetails = details;
    resetHistoryTooltipPayloads();
    hideHistoryTooltip();

    el.innerHTML =
      renderUsageHistorySection(details, today, providers);

    bindHistoryRangeControls(details, today, providers);
    bindHistoryTooltipControls(el);
  }

  function renderTodayInHistory(cards, source) {
    if (!cards || !cards.length) { return ''; }
    var cardSource = source || sectionSourceFromCards(cards);
    var primaryCards = cards.filter(function(card) { return !isApiEstimateCard(card); });
    var apiCard = null;
    for (var i = 0; i < cards.length; i++) { if (isApiEstimateCard(cards[i])) { apiCard = cards[i]; break; } }
    if (!primaryCards.length && !apiCard) { return ''; }
    return '<div class="usage-today-inline">' +
      '<div class="usage-today-inline-label">Today</div>' +
      (primaryCards.length ? '<div class="usage-metric-grid">' + primaryCards.map(function(card) { return renderUsageMetricCard(card, cardSource); }).join('') + '</div>' : '') +
      (apiCard ? renderApiEstimateStrip(apiCard) : '') +
    '</div>';
  }

  function renderUsageHistorySection(details, today, providers) {
    var aggregate = selectDashboardHistoryAggregate(details, providers);
    var aggregateBody = renderDashboardHistoryAggregateBody(aggregate);
    var gridClass = aggregate.provider === 'combined' ? 'usage-section-provider-grid combined' : 'usage-section-provider-grid';
    var titleSource = aggregate.source || sectionSourceFromProviderCharts(details && details.historyChart, details && details.codexHistoryChart, details && details.source);

    return '<section class="usage-dashboard-section">' +
      '<div class="usage-history-section-head">' +
        '<div>' +
          renderUsageSectionTitle('h3', 'usage-section-title', 'History', titleSource) +
          '<p class="usage-section-copy">Range-controlled usage trends by provider.</p>' +
        '</div>' +
      '</div>' +
      '<div class="' + gridClass + '">' +
        '<section class="usage-section-provider-card' + (aggregate.provider === 'combined' ? ' combined-history' : '') + (aggregate.unavailable ? ' unavailable' : '') + '">' +
          '<div class="usage-section-provider-head">' +
            '<div class="usage-section-provider-title">' + esc(aggregate.label) + '</div>' +
          '</div>' +
          aggregateBody +
        '</section>' +
      '</div>' +
    '</section>';
  }

  function renderDashboardHistoryAggregateBody(aggregate) {
    var todayHtml = renderTodayInHistory(aggregate.todayCards, aggregate.todaySource || aggregate.source);
    var unavailableReason = aggregate.unavailableReason || 'No selected provider history data is available yet.';
    var chartHtml = aggregate.unavailable
      ? renderProviderUnavailable('History unavailable', unavailableReason)
      : renderHistoryChart(aggregate.chart, aggregate.provider, aggregate.range, aggregate.source) +
        (aggregate.showCombinedLegend ? renderCombinedHistoryLegend(aggregate.chart) : '') +
        renderActiveDaysLabel(aggregate.chart);
    var distributionHtml = aggregate.distribution && aggregate.distribution.available
      ? renderClaudeModelDistribution(aggregate.distribution, aggregate.distribution && aggregate.distribution.source)
      : renderModelDistributionUnavailable(aggregate.distribution, aggregate.label);
    var metricGridHtml = renderMetricGrid(aggregate.cards, aggregate.emptyCardsText, aggregate.source);
    return todayHtml + chartHtml + distributionHtml + metricGridHtml;
  }

  function selectDashboardHistoryAggregate(details, providers) {
    var selectedProviders = dashboardAggregateProviders(providers);
    if (!selectedProviders.length) {
      selectedProviders = inferDashboardAggregateProviders(details);
    }
    var includeClaude = selectedProviders.indexOf('claude') >= 0;
    var includeCodex = selectedProviders.indexOf('codex') >= 0;

    if (includeClaude && includeCodex) {
      if (historyChartHasAvailablePoints(details && details.combinedHistoryChart)) {
        return buildCombinedHistoryAggregate(details);
      }

      var claudeAvailable = historyChartHasAvailablePoints(details && details.historyChart);
      var codexAvailable = historyChartHasAvailablePoints(details && details.codexHistoryChart);
      if (claudeAvailable && !codexAvailable) {
        return buildProviderHistoryAggregate(details, 'claude', details && details.claudeHistorySectionLabel || 'Claude', 'combined', 'combined', currentCombinedHistoryRange);
      }
      if (codexAvailable && !claudeAvailable) {
        return buildProviderHistoryAggregate(details, 'codex', details && details.codexHistorySectionLabel || 'Codex', 'combined', 'combined', currentCombinedHistoryRange);
      }
      if (claudeAvailable && codexAvailable) {
        return buildCombinedHistoryAggregate(details);
      }
      return buildUnavailableHistoryAggregate(details, 'combined', details && details.combinedHistorySectionLabel || 'Claude + Codex');
    }

    if (includeCodex) {
      return buildProviderHistoryAggregate(details, 'codex');
    }
    return buildProviderHistoryAggregate(details, 'claude');
  }

  function buildCombinedHistoryAggregate(details) {
    var selectedCombinedChart = selectCombinedHistoryChartRange(details && details.combinedHistoryChart, currentCombinedHistoryRange);
    var selectedCombinedOneDayChart = selectCombinedHistoryChartRange(details && details.combinedHistoryChart, '1D');
    var unavailable = !selectedCombinedChart || !selectedCombinedChart.available;
    return {
      provider: 'combined',
      todayContext: 'combined',
      range: currentCombinedHistoryRange,
      label: details && details.combinedHistorySectionLabel || 'Claude + Codex',
      chart: selectedCombinedChart,
      todayCards: selectedCombinedOneDayChart && selectedCombinedOneDayChart.available
        ? selectCombinedHistoryMetricCardsRange(details && details.cards, selectedCombinedOneDayChart, '1D')
        : [],
      todaySource: selectedCombinedOneDayChart && selectedCombinedOneDayChart.source,
      cards: selectCombinedHistoryMetricCardsRange(details && details.cards, selectedCombinedChart, currentCombinedHistoryRange),
      distribution: selectCombinedModelDistributionRange(details, selectedCombinedChart, currentCombinedHistoryRange),
      source: selectedCombinedChart && selectedCombinedChart.source,
      unavailable: unavailable,
      unavailableReason: selectedCombinedChart && selectedCombinedChart.unavailableReason || 'Combined history needs selected provider data.',
      emptyCardsText: 'No combined history cards available.',
      showCombinedLegend: true
    };
  }

  function buildProviderHistoryAggregate(details, provider, labelOverride, todayContextOverride, renderProviderOverride, rangeOverride) {
    var isCodex = provider === 'codex';
    var baseChart = isCodex ? details && details.codexHistoryChart : details && details.historyChart;
    var range = rangeOverride || (isCodex ? currentCodexHistoryRange : currentClaudeHistoryRange);
    var selectedChart = isCodex
      ? selectCodexHistoryChartRange(baseChart, range)
      : selectClaudeHistoryChartRange(baseChart, range);
    var selectedOneDayChart = isCodex
      ? selectCodexHistoryChartRange(baseChart, '1D')
      : selectClaudeHistoryChartRange(baseChart, '1D');
    var cardKeys = isCodex
      ? [
        'codexHistoryActivity',
        'codexHistoryTokens',
        'codexHistoryInputOutput',
        'codexHistoryCache',
        'codexHistoryApiEquivalent'
      ]
      : [
        'historyActivity',
        'historyTokens',
        'historyInputOutput',
        'historyCache',
        'historyApiEquivalent'
      ];
    var baseCards = usageCardsByKey(details && details.cards, cardKeys);
    var cards = isCodex
      ? selectCodexHistoryMetricCardsRange(baseCards, baseChart, range)
      : selectClaudeHistoryMetricCardsRange(baseCards, baseChart, range);
    var todayCards = selectedOneDayChart && selectedOneDayChart.available
      ? (isCodex
        ? selectCodexHistoryMetricCardsRange(baseCards, baseChart, '1D')
        : selectClaudeHistoryMetricCardsRange(baseCards, baseChart, '1D'))
      : [];
    var distribution = isCodex
      ? selectCodexModelDistributionRange(details && details.codexModelDistribution, baseChart, range)
      : selectClaudeModelDistributionRange(details && details.modelDistribution, baseChart, range);
    var label = labelOverride || (isCodex
      ? details && details.codexHistorySectionLabel || 'Codex'
      : details && details.claudeHistorySectionLabel || 'Claude');
    return {
      provider: renderProviderOverride || provider,
      todayContext: todayContextOverride || (isCodex ? 'codex' : 'claude'),
      range: range,
      label: label,
      chart: selectedChart,
      todayCards: todayCards,
      todaySource: selectedOneDayChart && selectedOneDayChart.source,
      cards: cards,
      distribution: distribution,
      source: selectedChart && selectedChart.source,
      unavailable: !selectedChart || !selectedChart.available,
      unavailableReason: selectedChart && selectedChart.unavailableReason || 'No ' + label + ' history data is available yet.',
      emptyCardsText: 'No ' + label + ' history cards available.'
    };
  }

  function buildUnavailableHistoryAggregate(details, provider, label) {
    var fallbackChart = provider === 'codex' ? details && details.codexHistoryChart : details && details.historyChart;
    var fallbackDistribution = provider === 'codex' ? details && details.codexModelDistribution : details && details.modelDistribution;
    var reason = fallbackChart && fallbackChart.unavailableReason || 'No selected provider history data is available yet.';
    return {
      provider: provider,
      todayContext: provider === 'combined' ? 'combined' : provider,
      range: provider === 'codex' ? currentCodexHistoryRange : provider === 'combined' ? currentCombinedHistoryRange : currentClaudeHistoryRange,
      label: label,
      chart: fallbackChart,
      cards: [],
      distribution: fallbackDistribution,
      source: fallbackChart && fallbackChart.source,
      unavailable: true,
      unavailableReason: reason,
      emptyCardsText: 'No selected provider history cards available.'
    };
  }

  function historyChartHasAvailablePoints(chart) {
    return Boolean(chart && chart.available && chart.points && chart.points.length);
  }

  function inferDashboardAggregateProviders(details) {
    var inferred = [];
    if (details && details.historyChart) { inferred.push('claude'); }
    if (details && details.codexHistoryChart) { inferred.push('codex'); }
    return inferred;
  }

  function renderCombinedHistoryLegend(chart) {
    if (hasHistoryModelStacks(chart)) {
      return '';
    }
    return '<div class="usage-history-legend" aria-label="Combined history legend">' +
      '<span><span class="usage-history-legend-swatch claude" title="Claude trusted completed-turn data"></span>Claude</span>' +
      '<span><span class="usage-history-legend-swatch codex" title="Codex correlated data; hatched"></span>Codex</span>' +
    '</div>';
  }

  function renderActiveDaysLabel(chart) {
    if (!chart || !chart.available || !chart.points || !chart.points.length) { return ''; }
    var activeBins = typeof chart.activeBinCount === 'number' ? chart.activeBinCount : countActiveHistoryDays(chart.points);
    var totalBins = chart.points.length;
    var unitLabel = chart.activeUnitLabel || 'days';
    var adj = unitLabel === 'weeks' ? 'weekly' : unitLabel === 'months' ? 'monthly' : 'daily';
    var percent = totalBins > 0 ? Math.round((activeBins / totalBins) * 100) : 0;
    return '<div class="usage-history-active-days">' +
      '<span class="usage-history-active-days-count">' + esc(activeBins + ' / ' + totalBins + ' active ' + unitLabel) + '</span>' +
      '<span class="usage-history-active-days-pct">' + esc(percent + '% of ' + adj + ' bins') + '</span>' +
    '</div>';
  }

  function isApiEstimateCard(card) {
    return Boolean(card && card.key && /ApiEquivalent$/.test(card.key));
  }

  function renderApiEstimateStrip(card) {
    if (!card) { return ''; }
    var unavailableClass = card.available ? '' : ' unavailable';
    var tooltip = card.detailTooltip || (card.source && (card.source.detail || card.source.unavailableReason)) || '';
    var titleAttr = tooltip ? ' title="' + escAttr(tooltip) + '"' : '';
    var detail = card.detail || '';
    var detailLines = renderMetricDetailLines(card);
    var visibleDetail = detailLines || (detail && detail.indexOf('not actual billing') < 0 ? esc(detail) : '');
    var parts = [esc(card.label || 'API estimate') + ': <span class="usage-api-estimate-value">' + esc(card.value || 'Unavailable') + '</span>'];
    if (visibleDetail) { parts.push(visibleDetail); }
    return '<div class="usage-api-estimate-strip' + unavailableClass + '"' + titleAttr + '>' +
      parts.join(detailLines ? '<br>' : ' · ') +
    '</div>';
  }

  function renderMetricGrid(cards, emptyText, parentSource) {
    if (!cards || !cards.length) {
      return '<div class="usage-empty">' + esc(emptyText || 'No cards available.') + '</div>';
    }
    var primaryCards = cards.filter(function(card) { return !isApiEstimateCard(card); });
    var apiCard = null;
    for (var i = 0; i < cards.length; i++) { if (isApiEstimateCard(cards[i])) { apiCard = cards[i]; break; } }
    var gridHtml = primaryCards.length
      ? '<div class="usage-metric-grid">' + primaryCards.map(function(card) { return renderUsageMetricCard(card, parentSource); }).join('') + '</div>'
      : (apiCard ? '' : '<div class="usage-empty">' + esc(emptyText || 'No cards available.') + '</div>');
    return gridHtml + (apiCard ? renderApiEstimateStrip(apiCard) : '');
  }

  function renderSectionProviderGrid(providerCards, emptyText) {
    return providerCards && providerCards.length
      ? '<div class="usage-section-provider-grid">' + providerCards.join('') + '</div>'
      : '<div class="usage-empty">' + esc(emptyText || 'No provider data is available yet.') + '</div>';
  }

  function renderSectionProviderCard(label, source, body, unavailable) {
    return '<section class="usage-section-provider-card' + (unavailable ? ' unavailable' : '') + '">' +
      '<div class="usage-section-provider-head">' +
        '<div class="usage-section-provider-title">' + esc(label) + '</div>' +
      '</div>' +
      body +
    '</section>';
  }

  function sectionSourceFromProviderCharts(primary, secondary, fallback) {
    return (primary && primary.source) || (secondary && secondary.source) || fallback;
  }

  function renderHistoryUnavailable(chart, label) {
    var reason = (chart && chart.unavailableReason) || 'No ' + label + ' history data is available yet.';
    return '<div class="usage-history-chart unavailable">' +
      '<div class="usage-empty">' + esc(reason) + '</div>' +
    '</div>';
  }

  function renderModelDistributionUnavailable(distribution, label) {
    var reason = (distribution && distribution.unavailableReason) || 'No ' + label + ' model distribution is available yet.';
    return '<div class="usage-model-distribution unavailable">' +
      '<div class="usage-empty">' + esc(reason) + '</div>' +
    '</div>';
  }

  function usageCardsByKey(cards, keys) {
    if (!cards || !cards.length) {
      return [];
    }
    var wanted = {};
    keys.forEach(function(key) { wanted[key] = true; });
    return cards.filter(function(card) { return card && wanted[card.key]; });
  }

  function renderUsageSectionTitle(tagName, className, title, source) {
    var tag = tagName === 'h4' ? 'h4' : 'h3';
    return '<' + tag + ' class="' + className + '"><span>' + esc(title) + '</span></' + tag + '>';
  }

  function sectionSourceFromCards(cards, fallback) {
    if (cards && cards.length) {
      for (var i = 0; i < cards.length; i += 1) {
        if (cards[i] && cards[i].source) {
          return cards[i].source;
        }
      }
    }
    return fallback;
  }

  function renderUsageDetailsProviderSection(providers, source) {
    if (!providers) {
      return '';
    }
    return '<section class="usage-details-section">' +
      renderUsageSectionTitle('h4', 'usage-details-section-title', 'Provider Details', source) +
      '<p class="usage-details-section-copy">Current per-provider normalized snapshot details.</p>' +
      '<div class="usage-details-provider-list">' + providers + '</div>' +
    '</section>';
  }

  function renderHistoryChart(chart, provider, currentRange, parentSource) {
    if (!chart) {
      return '<div class="usage-history-chart unavailable">' +
        '<div class="usage-empty">' + esc((provider === 'codex' ? 'Codex' : 'Claude') + ' history chart is unavailable.') + '</div>' +
      '</div>';
    }

    var unavailableClass = chart.available ? '' : ' unavailable';
    var ranges = chart.ranges && chart.ranges.length
      ? chart.ranges.filter(function(r) { return r && r.available; }).map(function(r) { return renderHistoryRange(r, chart.key || currentRange, provider); }).join('')
      : '';
    var metaText = [
      chart.rangeLabel || '1M / 30d',
      chart.granularityLabel || '',
      chart.limitation || '',
      chart.unavailableReason || ''
    ].filter(Boolean).join(' · ');

    return '<div class="usage-history-chart' + unavailableClass + '">' +
      '<div class="usage-history-chart-head">' +
        '<div>' +
          '<div class="usage-history-chart-title"><span>' + esc(chart.title || 'Token trend') + '</span>' + renderSourceChip(chart.source, 'glyph') + '</div>' +
          '<div class="usage-history-chart-meta">' + esc(metaText) + '</div>' +
        '</div>' +
        '<div class="usage-history-ranges">' + ranges + '</div>' +
      '</div>' +
      renderHistoryBars(chart, provider) +
    '</div>';
  }

  function renderHistoryRange(range, activeRangeKey, provider) {
    var active = range && range.key === activeRangeKey;
    var unavailable = !range || !range.available;
    var cls = 'usage-history-range' + (active ? ' active' : '') + (unavailable ? ' unavailable' : '');
    var title = unavailable ? ' title="Unavailable in this slice"' : '';
    var dataRange = range && range.key ? ' data-usage-history-range="' + esc(range.key) + '"' : '';
    var dataProvider = provider ? ' data-history-provider="' + esc(provider) + '"' : '';
    return '<span class="' + cls + '"' + dataRange + dataProvider + title + '>' + esc(range && range.label ? range.label : 'Range') + '</span>';
  }

  function buildHistoryPointTooltip(point) {
    var binLabel = point.binStartDateKey && point.binEndDateKey && point.binStartDateKey !== point.binEndDateKey
      ? point.binStartDateKey + ' to ' + point.binEndDateKey
      : point.dateKey || point.label || 'Unknown date';
    var models = (point.models || [])
      .slice()
      .sort(function(a, b) { return Number(b.totalTokens || 0) - Number(a.totalTokens || 0); })
      .slice(0, HISTORY_TOOLTIP_MODEL_LIMIT)
      .map(function(model) {
        var total = Number(point.totalTokens || 0);
        var percent = total > 0 ? Number(model.totalTokens || 0) / total : 0;
        return (model.label || model.model || 'Model') + ': ' +
          formatMetricNumber(model.totalTokens) + ' tokens (' + formatPercentLabel(percent) + ')';
      });

    var lines = [
      binLabel,
      'Total tokens: ' + formatMetricNumber(point.totalTokens),
      'Input tokens: ' + formatMetricNumber(point.inputTokens),
      'Output tokens: ' + formatMetricNumber(point.outputTokens),
      'Cache tokens: ' + formatMetricNumber(point.cacheTokens),
      'Cache write: ' + formatMetricNumber(point.cacheCreationTokens),
      'Cache read: ' + formatMetricNumber(point.cacheReadTokens),
      'Assistant messages: ' + formatMetricNumber(point.assistantMessages),
      'Source day buckets: ' + formatMetricNumber(point.sourcePointCount || 0)
    ];

    var providerLines = buildHistoryProviderTooltipLines(point);
    if (providerLines.length) {
      lines.push('Providers: ' + providerLines.join(' | '));
    }
    if (models.length) {
      lines.push('Top models: ' + models.join(' | '));
    } else {
      lines.push('Top models: none for this point');
    }

    return lines.join('\n');
  }

  function buildHistoryTooltipPayload(point, provider, chart) {
    var binLabel = point.binStartDateKey && point.binEndDateKey && point.binStartDateKey !== point.binEndDateKey
      ? point.binStartDateKey + ' to ' + point.binEndDateKey
      : point.dateKey || point.label || 'Unknown date';
    var total = Number(point.totalTokens || 0);
    var hasModelStack = buildHistoryModelStackSegments(point, chart).length > 0;
    var colorForModel = historyModelColorResolver(chart);
    var topModels = (point.models || [])
      .slice()
      .sort(function(a, b) { return Number(b.totalTokens || 0) - Number(a.totalTokens || 0); })
      .slice(0, HISTORY_TOOLTIP_MODEL_LIMIT)
      .map(function(model, index) {
        var modelTokens = Number(model.totalTokens || 0);
        return {
          label: model.label || model.model || 'Model',
          tokens: modelTokens,
          percentLabel: total > 0 ? formatPercentLabel(modelTokens / total) : '0%',
          messages: Number(model.assistantMessages || 0),
          color: colorForModel(model, index)
        };
      });
    var providerRows = (point.providerSegments || [])
      .filter(function(segment) { return segment && Number(segment.totalTokens || 0) > 0; })
      .map(function(segment) {
        var label = segment.label || (segment.provider === 'codex' ? 'Codex' : 'Claude');
        return {
          provider: segment.provider === 'codex' ? 'codex' : 'claude',
          label: label,
          tokens: Number(segment.totalTokens || 0),
          activityLabel: segment.provider === 'codex' ? 'turns' : 'messages',
          activity: Number(segment.assistantMessages || 0)
        };
      });

    return {
      provider: provider || 'claude',
      binLabel: binLabel,
      totalTokens: total,
      activityLabel: provider === 'codex' ? 'Correlated turns' : provider === 'combined' ? 'Messages / turns' : 'Assistant messages',
      activity: Number(point.assistantMessages || 0),
      sourceText: buildHistoryTooltipSourceText(provider, chart && chart.source),
      providerRows: providerRows,
      showProviderSwatches: provider === 'combined' && hasModelStack ? false : true,
      topModels: topModels,
      ariaLabel: buildHistoryPointTooltip(point).replace(/\s+/g, ' ')
    };
  }

  function buildHistoryTooltipSourceText(provider, source) {
    if (provider === 'combined') { return 'Claude trusted usage + Codex correlated usage'; }
    if (provider === 'codex') { return 'Codex correlated usage'; }
    if (provider === 'claude') { return 'Claude trusted usage'; }
    return source && source.label ? source.label : 'Usage history';
  }

  function resetHistoryTooltipPayloads() {
    historyTooltipPayloads = {};
    historyTooltipIdCounter = 0;
    modelTooltipIdCounter = 0;
  }

  function registerHistoryTooltipPayload(payload) {
    historyTooltipIdCounter += 1;
    var id = 'history-tip-' + historyTooltipIdCounter;
    historyTooltipPayloads[id] = payload;
    return id;
  }

  function registerModelTooltipPayload(payload) {
    modelTooltipIdCounter += 1;
    var id = 'model-tip-' + modelTooltipIdCounter;
    payload.kind = 'modelDistribution';
    historyTooltipPayloads[id] = payload;
    return id;
  }

  function buildHistoryProviderTooltipLines(point) {
    return (point.providerSegments || [])
      .filter(function(segment) { return segment && Number(segment.totalTokens || 0) > 0; })
      .map(function(segment) {
        var label = segment.label || (segment.provider === 'codex' ? 'Codex' : 'Claude');
        var suffix = segment.provider === 'codex' ? ' correlated' : ' trusted';
        return label + ': ' + formatMetricNumber(segment.totalTokens) + ' tokens' + suffix;
      });
  }

  function buildModelDistributionTooltipPayload(distribution, segment, index) {
    var providerLabel = modelDistributionProviderLabel(distribution, segment);
    var activityLabel = providerLabel === 'Codex' ? 'Correlated turns' : 'Assistant messages';
    var label = segment.label || segment.model || 'Model';
    var payload = {
      label: label,
      model: segment.model || label,
      providerLabel: providerLabel,
      rangeLabel: distribution.rangeLabel || 'Selected range',
      totalTokens: Number(segment.totalTokens || 0),
      percentLabel: segment.percentLabel || formatPercentLabel(segment.percent || 0),
      activityLabel: activityLabel,
      activity: Number(segment.assistantMessages || 0),
      color: modelSeriesColor(index)
    };
    payload.ariaLabel = buildModelDistributionAriaLabel(payload);
    return payload;
  }

  function modelDistributionProviderLabel(distribution, segment) {
    if (segment && segment.providerLabel) { return segment.providerLabel; }
    if (segment && segment.provider === 'codex') { return 'Codex'; }
    if (segment && segment.provider === 'claude') { return 'Claude'; }
    if (distribution && distribution.providerLabel) { return distribution.providerLabel; }
    var label = String((segment && (segment.label || segment.model)) || '');
    if (label.indexOf('Claude ') === 0) { return 'Claude'; }
    if (label.indexOf('Codex ') === 0) { return 'Codex'; }
    var confidence = distribution && distribution.source && distribution.source.confidence;
    if (confidence === 'trustedCompletedTurnUsage') { return 'Claude'; }
    if (confidence === 'correlatedDayBucket') { return 'Codex'; }
    return '';
  }

  function buildModelDistributionAriaLabel(payload) {
    var parts = [
      payload.providerLabel ? payload.providerLabel + ' model' : 'Model',
      payload.label,
      formatMetricNumber(payload.totalTokens) + ' tokens',
      payload.percentLabel,
      formatMetricNumber(payload.activity) + ' ' + payload.activityLabel
    ];
    return parts.filter(Boolean).join(', ');
  }

  function renderHistoryBars(chart, provider) {
    var label = chart.ariaLabel || 'Token trend chart';
    if (!chart.available || !chart.points || !chart.points.length) {
      return '<div class="usage-empty">' + esc(chart.unavailableReason || 'No history points are available for this range.') + '</div>';
    }

    var max = chart.maxTotalTokens || 0;
    var bars = chart.points.map(function(point) {
      var empty = Boolean(point.isEmpty || (Number(point.totalTokens || 0) <= 0 && Number(point.assistantMessages || 0) <= 0));
      var height = max > 0 ? Math.max(2, Math.round((point.totalTokens / max) * 100)) : 3;
      var payload = buildHistoryTooltipPayload(point, provider, chart);
      var tooltipId = registerHistoryTooltipPayload(payload);
      var fillHtml = renderHistoryBarFill(point, height, chart, provider);
      return '<div class="usage-history-bar' + (empty ? ' empty' : '') + '" tabindex="0" data-history-tip-id="' + escAttr(tooltipId) + '" aria-label="' + escAttr(payload.ariaLabel) + '">' +
        fillHtml +
      '</div>';
    }).join('');

    var first = chart.points[0] ? chart.points[0].label : '';
    var last = chart.points[chart.points.length - 1] ? chart.points[chart.points.length - 1].label : '';
    var count = Math.max(1, chart.points.length);
    var axis = chart.axisLabel || chart.granularityLabel || '';

    return '<div class="usage-history-bars" style="--history-bin-count:' + esc(count) + '" role="img" aria-label="' + esc(label) + '">' + bars + '</div>' +
      '<div class="usage-history-axis"><span>' + esc(first) + '</span><span>' + esc(axis) + '</span><span>' + esc(last) + '</span></div>';
  }

  function renderHistoryBarFill(point, height, chart, provider) {
    var modelSegments = buildHistoryModelStackSegments(point, chart);
    if (modelSegments.length) {
      return renderHistoryModelStackFill(modelSegments, point, height, provider);
    }
    if (provider === 'combined') {
      return renderCombinedHistoryBarFill(point, height);
    }
    return '<div class="usage-history-bar-fill" style="height:' + height + '%"></div>';
  }

  function hasHistoryModelStacks(chart) {
    return Boolean(chart && chart.available && (chart.points || []).some(function(point) {
      return buildHistoryModelStackSegments(point, chart).length > 0;
    }));
  }

  function renderHistoryModelStackFill(segments, point, height, provider) {
    var total = Number(point.totalTokens || 0);
    if (total <= 0 || !segments.length) {
      return '<div class="usage-history-bar-fill" style="height:' + height + '%"></div>';
    }
    var segmentHtml = segments.map(function(segment) {
      var percent = Math.max(0, Math.min(100, (Number(segment.totalTokens || 0) / total) * 100));
      var label = segment.label || segment.model || 'Model';
      return '<div class="usage-history-bar-segment model" style="height:' + percent + '%;background-color:' + escAttr(segment.color) + '" aria-label="' + escAttr(label + ' ' + formatMetricNumber(segment.totalTokens) + ' tokens') + '"></div>';
    }).join('');
    return '<div class="usage-history-bar-fill stacked" style="height:' + height + '%">' + segmentHtml + '</div>';
  }

  function buildHistoryModelStackSegments(point, chart) {
    var total = Number(point && point.totalTokens || 0);
    var models = (point && point.models || []).filter(function(model) {
      return model && Number(model.totalTokens || 0) > 0;
    });
    if (total <= 0 || !models.length) { return []; }

    var modelTotal = models.reduce(function(sum, model) { return sum + Number(model.totalTokens || 0); }, 0);
    if (Math.abs(modelTotal - total) > Math.max(1, total * 0.01)) { return []; }

    var palette = historyModelPalette(chart);
    var segmentsByKey = {};
    models.forEach(function(model) {
      var key = historyModelKey(model);
      var paletteEntry = palette.byModel[key] || palette.other;
      if (!paletteEntry) { return; }
      var segmentKey = paletteEntry.model;
      if (!segmentsByKey[segmentKey]) {
        segmentsByKey[segmentKey] = {
          label: paletteEntry.label,
          model: paletteEntry.model,
          totalTokens: 0,
          index: paletteEntry.index,
          color: paletteEntry.color
        };
      }
      segmentsByKey[segmentKey].totalTokens += Number(model.totalTokens || 0);
    });

    return Object.keys(segmentsByKey)
      .map(function(key) { return segmentsByKey[key]; })
      .filter(function(segment) { return segment.totalTokens > 0; })
      .sort(function(a, b) { return a.index - b.index; });
  }

  function historyModelColorResolver(chart) {
    var palette = historyModelPalette(chart);
    return function(model, fallbackIndex) {
      var entry = palette.byModel[historyModelKey(model)] || palette.other;
      return entry ? entry.color : modelSeriesColor(fallbackIndex || 0);
    };
  }

  function historyModelPalette(chart) {
    var points = chart && chart.points ? chart.points : [];
    var aggregate = chart && chart.source && chart.source.confidence === 'mixedDayBucket'
      ? aggregateCombinedModelDistribution(points)
      : aggregateModelDistribution(points);
    var byModel = {};
    var other;

    aggregate.forEach(function(entry, index) {
      var paletteEntry = {
        label: entry.label || entry.model || 'Model',
        model: entry.model || entry.label || 'Model',
        index: index,
        color: modelSeriesColor(index)
      };
      byModel[historyModelKey(entry)] = paletteEntry;
      if (paletteEntry.model === 'Other' || paletteEntry.label === 'Other') {
        other = paletteEntry;
      }
    });

    return { byModel: byModel, other: other };
  }

  function historyModelKey(model) {
    return String(model && (model.model || model.label) || 'unknown');
  }

  function renderCombinedHistoryBarFill(point, height) {
    var total = Number(point.totalTokens || 0);
    var segments = (point.providerSegments || []).filter(function(segment) {
      return segment && Number(segment.totalTokens || 0) > 0;
    });
    if (total <= 0 || !segments.length) {
      return '<div class="usage-history-bar-fill" style="height:' + height + '%"></div>';
    }
    var segmentHtml = segments.map(function(segment) {
      var percent = Math.max(0, Math.min(100, (Number(segment.totalTokens || 0) / total) * 100));
      var providerClass = segment.provider === 'codex' ? ' codex' : ' claude';
      var label = segment.label || (segment.provider === 'codex' ? 'Codex' : 'Claude');
      return '<div class="usage-history-bar-segment' + providerClass + '" style="height:' + percent + '%" aria-label="' + esc(label + ' ' + formatMetricNumber(segment.totalTokens) + ' tokens') + '"></div>';
    }).join('');
    return '<div class="usage-history-bar-fill combined" style="height:' + height + '%">' + segmentHtml + '</div>';
  }

  var SOURCE_CHIP_CONFIG = {
    trustedCompletedTurnUsage: { cls: 'trusted', fullLabel: 'Trusted', compactLabel: 'Trusted' },
    correlatedDayBucket: { cls: 'correlated', fullLabel: 'Correlated', compactLabel: 'Corr.' },
    mixedDayBucket: { cls: 'mixed', fullLabel: 'Mixed', compactLabel: 'Mixed' },
    quotaState: { cls: 'quota', fullLabel: 'Quota state', compactLabel: 'Quota' },
    snapshotOnly: { cls: 'snapshot', fullLabel: 'Snapshot', compactLabel: 'Snap.' },
    apiEquivalentEstimate: { cls: 'estimate', fullLabel: 'Estimate', compactLabel: 'Est.' },
    unavailable: { cls: 'unavailable', fullLabel: 'Unavailable', compactLabel: 'N/A' }
  };

  function renderSourceChip(source, mode) {
    if (!source) { return ''; }
    var cfg = SOURCE_CHIP_CONFIG[source.confidence];
    if (!cfg) { return ''; }
    var parts = [source.label];
    if (source.detail) { parts.push(source.detail); }
    if (source.unavailableReason) { parts.push(source.unavailableReason); }
    var chipMode = mode === 'compact' || mode === 'glyph' ? mode : 'full';
    var label = chipMode === 'full' ? cfg.fullLabel : cfg.compactLabel;
    var title = parts.join(' - ');
    var aria = cfg.fullLabel + (title ? ': ' + title : '');
    var labelHtml = chipMode === 'glyph' ? '' : '<span class="source-chip-label">' + esc(label) + '</span>';
    return '<span class="source-chip ' + cfg.cls + ' ' + chipMode + '" title="' + esc(title) + '" aria-label="' + esc(aria) + '">' +
      '<span class="source-chip-mark"></span>' +
      labelHtml +
    '</span>';
  }

  function renderMetricSourceChip(source, parentSource) {
    if (!source) { return ''; }
    return renderSourceChip(source, 'glyph');
  }

  function renderClaudeModelDistribution(distribution, parentSource) {
    if (!distribution) { return ''; }
    if (!distribution.available || !distribution.segments || !distribution.segments.length) {
      return '<div class="usage-model-distribution unavailable">' +
        '<div class="usage-empty">' + esc(distribution.unavailableReason || 'Model distribution is unavailable.') + '</div>' +
      '</div>';
    }
    var metaText = [
      distribution.rangeLabel || '1M / 30d',
      formatMetricNumber(distribution.totalTokens) + ' total tokens'
    ].filter(Boolean).join(' · ');

    return '<div class="usage-model-distribution">' +
      '<div class="usage-model-distribution-head">' +
        '<div>' +
          '<div class="usage-model-distribution-title"><span>' + esc(distribution.title || 'Model distribution') + '</span>' + renderSourceChip(distribution.source, 'glyph') + '</div>' +
          '<div class="usage-model-distribution-meta">' + esc(metaText) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="usage-model-distribution-body">' +
        renderModelDistributionDonut(distribution) +
        renderModelDistributionLegend(distribution) +
      '</div>' +
    '</div>';
  }

  function renderModelDistributionDonut(distribution) {
    return '<div class="usage-model-donut">' +
      renderModelDistributionDonutSvg(distribution) +
      '<div class="usage-model-donut-core">' +
        '<div class="usage-model-donut-total">' + esc(formatMetricNumber(distribution.totalTokens)) + '</div>' +
        '<div class="usage-model-donut-label">total</div>' +
      '</div>' +
    '</div>';
  }

  function renderModelDistributionDonutSvg(distribution) {
    var segments = distribution.segments || [];
    if (!segments.length) { return ''; }

    var radius = 46;
    var circumference = 2 * Math.PI * radius;
    var offset = 0;

    var circles = segments.map(function(segment, index) {
      var percent = Math.max(0, Number(segment.percent || 0));
      var dashLength = Math.max(0, percent * circumference);
      var gapLength = Math.max(0, circumference - dashLength);
      var color = modelSeriesColor(index);
      var payload = buildModelDistributionTooltipPayload(distribution, segment, index);
      var tooltipId = registerModelTooltipPayload(payload);

      var circle = '<circle class="usage-model-donut-segment" ' +
        'cx="56" cy="56" r="' + radius + '" ' +
        'tabindex="0" focusable="true" data-model-tip-id="' + escAttr(tooltipId) + '" ' +
        'aria-label="' + escAttr(payload.ariaLabel) + '" ' +
        'stroke="' + color + '" stroke-width="20" ' +
        'stroke-dasharray="' + dashLength.toFixed(3) + ' ' + gapLength.toFixed(3) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(3) + '"></circle>';

      offset += dashLength;
      return circle;
    }).join('');

    return '<svg class="usage-model-donut-svg" viewBox="0 0 112 112" role="img" aria-label="' +
      esc(distribution.title || 'Model distribution') + '">' +
      '<circle class="usage-model-donut-segment" cx="56" cy="56" r="' + radius + '" stroke="rgba(127,127,127,.18)" stroke-width="20"></circle>' +
      circles +
    '</svg>';
  }

  function renderModelDistributionLegend(distribution) {
    var rows = (distribution.segments || []).map(function(segment, index) {
      var color = modelSeriesColor(index);
      var payload = buildModelDistributionTooltipPayload(distribution, segment, index);
      var tooltipId = registerModelTooltipPayload(payload);
      return '<div class="usage-model-row" tabindex="0" data-model-tip-id="' + escAttr(tooltipId) + '" aria-label="' + escAttr(payload.ariaLabel) + '">' +
        '<span class="usage-model-swatch" style="background:' + color + '"></span>' +
        '<span class="usage-model-name">' + esc(segment.label || 'Model') + '</span>' +
        '<span class="usage-model-value">' + esc(formatMetricNumber(segment.totalTokens)) + '</span>' +
        '<span class="usage-model-percent">' + esc(segment.percentLabel || '') + '</span>' +
      '</div>';
    }).join('');
    return '<div class="usage-model-legend">' + rows + '</div>';
  }

  function modelSeriesColor(index) {
    var colors = [
      'var(--vscode-charts-blue,#4f8fd6)',
      'var(--vscode-charts-yellow,#c79538)',
      'var(--vscode-charts-purple,#9b7bd3)',
      'var(--vscode-charts-orange,#c77737)',
      '#3aa99f',
      '#c96f8a',
      '#2f9ec2',
      '#8da653',
      '#6f83d8',
      '#a87854',
      '#7f9bb3',
      '#b76ac4'
    ];
    return colors[index % colors.length];
  }

  function bindHistoryTooltipControls(root) {
    if (!root || root.__historyTooltipBound) { return; }
    root.__historyTooltipBound = true;
    root.addEventListener('mouseover', function(event) {
      var target = closestHistoryTooltipTarget(event.target);
      if (!target) { return; }
      if (event.relatedTarget && target.contains(event.relatedTarget)) { return; }
      showHistoryTooltip(target);
    });
    root.addEventListener('mouseout', function(event) {
      var target = closestHistoryTooltipTarget(event.target);
      if (!target) { return; }
      if (event.relatedTarget && target.contains(event.relatedTarget)) { return; }
      hideHistoryTooltip();
    });
    root.addEventListener('focusin', function(event) {
      var target = closestHistoryTooltipTarget(event.target);
      if (target) { showHistoryTooltip(target); }
    });
    root.addEventListener('focusout', function(event) {
      var target = closestHistoryTooltipTarget(event.target);
      if (target) { hideHistoryTooltip(); }
    });
    root.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') { hideHistoryTooltip(); }
    });
    if (!window.__historyTooltipWindowBound) {
      window.__historyTooltipWindowBound = true;
      window.addEventListener('resize', positionHistoryTooltip);
      window.addEventListener('scroll', positionHistoryTooltip, true);
    }
  }

  function closestHistoryTooltipTarget(target) {
    while (target && target !== document) {
      if (target.getAttribute && (target.getAttribute('data-history-tip-id') || target.getAttribute('data-model-tip-id'))) {
        return target;
      }
      target = target.parentElement;
    }
    return null;
  }

  function ensureHistoryTooltip() {
    if (historyTooltipEl) { return historyTooltipEl; }
    historyTooltipEl = document.createElement('div');
    historyTooltipEl.id = 'pf-history-chart-tip';
    historyTooltipEl.className = 'ab-tip hidden';
    historyTooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(historyTooltipEl);
    return historyTooltipEl;
  }

  function showHistoryTooltip(anchor) {
    var id = anchor && anchor.getAttribute ? (anchor.getAttribute('data-history-tip-id') || anchor.getAttribute('data-model-tip-id')) : '';
    var payload = id ? historyTooltipPayloads[id] : null;
    if (!payload) { hideHistoryTooltip(); return; }
    var tip = ensureHistoryTooltip();
    historyTooltipAnchor = anchor;
    anchor.setAttribute('aria-describedby', tip.id);
    renderHistoryTooltipContent(tip, payload);
    tip.className = 'ab-tip';
    positionHistoryTooltip();
  }

  function hideHistoryTooltip() {
    if (historyTooltipAnchor && historyTooltipAnchor.removeAttribute) {
      historyTooltipAnchor.removeAttribute('aria-describedby');
    }
    historyTooltipAnchor = null;
    if (historyTooltipEl) { historyTooltipEl.className = 'ab-tip hidden'; }
  }

  function renderHistoryTooltipContent(tip, payload) {
    while (tip.firstChild) { tip.removeChild(tip.firstChild); }

    if (payload.kind === 'modelDistribution') {
      renderModelDistributionTooltipContent(tip, payload);
      return;
    }

    var header = document.createElement('div');
    header.className = 'ab-tip-head';
    var title = document.createElement('div');
    title.className = 'ab-tip-title';
    title.textContent = payload.binLabel || 'Usage bin';
    var source = document.createElement('div');
    source.className = 'ab-tip-source';
    source.textContent = payload.sourceText || 'Usage history';
    header.appendChild(title);
    header.appendChild(source);
    tip.appendChild(header);

    var stats = document.createElement('div');
    stats.className = 'ab-tip-stats';
    appendHistoryTooltipStat(stats, 'Total tokens', formatMetricNumber(payload.totalTokens));
    appendHistoryTooltipStat(stats, payload.activityLabel || 'Activity', formatMetricNumber(payload.activity));
    tip.appendChild(stats);

    if (payload.provider === 'combined' && payload.providerRows && payload.providerRows.length) {
      var providerList = document.createElement('div');
      providerList.className = 'ab-tip-list';
      appendHistoryTooltipListTitle(providerList, 'Providers');
      payload.providerRows.forEach(function(row) {
        var item = document.createElement('div');
        var providerClass = row.provider === 'codex' ? 'codex' : 'claude';
        item.className = 'ab-tip-provider-row' + (payload.showProviderSwatches === false ? '' : ' ' + providerClass);
        var label = document.createElement('span');
        label.textContent = row.label;
        var value = document.createElement('span');
        value.textContent = formatMetricNumber(row.tokens) + ' tokens - ' + formatMetricNumber(row.activity) + ' ' + row.activityLabel;
        item.appendChild(label);
        item.appendChild(value);
        providerList.appendChild(item);
      });
      tip.appendChild(providerList);
    }

    var modelList = document.createElement('div');
    modelList.className = 'ab-tip-list';
    appendHistoryTooltipListTitle(modelList, 'Top models');
    if (payload.topModels && payload.topModels.length) {
      payload.topModels.forEach(function(row) {
        var item = document.createElement('div');
        item.className = 'ab-tip-model-row';
        var labelWrap = document.createElement('span');
        labelWrap.className = 'ab-tip-model-label';
        var swatch = document.createElement('span');
        swatch.className = 'ab-tip-swatch';
        swatch.style.background = row.color;
        var lbl = document.createElement('span');
        lbl.textContent = row.label;
        labelWrap.appendChild(swatch);
        labelWrap.appendChild(lbl);
        var value = document.createElement('span');
        value.textContent = formatMetricNumber(row.tokens) + ' - ' + row.percentLabel;
        item.appendChild(labelWrap);
        item.appendChild(value);
        modelList.appendChild(item);
      });
    } else {
      var empty = document.createElement('div');
      empty.className = 'ab-tip-empty';
      empty.textContent = 'No model activity in this bin';
      modelList.appendChild(empty);
    }
    tip.appendChild(modelList);
  }

  function renderModelDistributionTooltipContent(tip, payload) {
    var header = document.createElement('div');
    header.className = 'ab-tip-head';
    var title = document.createElement('div');
    title.className = 'ab-tip-title';
    title.textContent = payload.label || 'Model';
    var source = document.createElement('div');
    source.className = 'ab-tip-source';
    source.textContent = [payload.providerLabel || 'Model distribution', payload.rangeLabel].filter(Boolean).join(' - ');
    header.appendChild(title);
    header.appendChild(source);
    tip.appendChild(header);

    var stats = document.createElement('div');
    stats.className = 'ab-tip-stats';
    appendHistoryTooltipStat(stats, 'Total tokens', formatMetricNumber(payload.totalTokens));
    appendHistoryTooltipStat(stats, 'Share', payload.percentLabel || '0%');
    appendHistoryTooltipStat(stats, payload.activityLabel || 'Activity', formatMetricNumber(payload.activity));
    tip.appendChild(stats);

    var modelList = document.createElement('div');
    modelList.className = 'ab-tip-list';
    appendHistoryTooltipListTitle(modelList, 'Series');
    var item = document.createElement('div');
    item.className = 'ab-tip-model-row';
    var labelWrap = document.createElement('span');
    labelWrap.className = 'ab-tip-model-label';
    var swatch = document.createElement('span');
    swatch.className = 'ab-tip-swatch';
    swatch.style.background = payload.color;
    var lbl = document.createElement('span');
    lbl.textContent = payload.providerLabel ? payload.providerLabel + ' - ' + payload.model : payload.model;
    labelWrap.appendChild(swatch);
    labelWrap.appendChild(lbl);
    var value = document.createElement('span');
    value.textContent = payload.percentLabel || '0%';
    item.appendChild(labelWrap);
    item.appendChild(value);
    modelList.appendChild(item);
    tip.appendChild(modelList);
  }

  function appendHistoryTooltipStat(parent, labelText, valueText) {
    var row = document.createElement('div');
    row.className = 'ab-tip-stat';
    var label = document.createElement('span');
    label.textContent = labelText;
    var value = document.createElement('strong');
    value.textContent = valueText;
    row.appendChild(label);
    row.appendChild(value);
    parent.appendChild(row);
  }

  function appendHistoryTooltipListTitle(parent, text) {
    var title = document.createElement('div');
    title.className = 'ab-tip-list-title';
    title.textContent = text;
    parent.appendChild(title);
  }

  function positionHistoryTooltip() {
    if (!historyTooltipEl || !historyTooltipAnchor || historyTooltipEl.className.indexOf('hidden') >= 0) { return; }
    var anchorRect = historyTooltipAnchor.getBoundingClientRect();
    var tipRect = historyTooltipEl.getBoundingClientRect();
    var margin = 8;
    var gap = 8;
    var viewportWidth = document.documentElement && document.documentElement.clientWidth ? document.documentElement.clientWidth : window.innerWidth;
    var viewportHeight = document.documentElement && document.documentElement.clientHeight ? document.documentElement.clientHeight : window.innerHeight;
    var left = anchorRect.left + (anchorRect.width - tipRect.width) / 2;
    var top = anchorRect.top - tipRect.height - gap;
    var placement = 'top';

    if (top < margin) { top = anchorRect.bottom + gap; placement = 'bottom'; }
    if (top + tipRect.height > viewportHeight - margin) { top = Math.max(margin, viewportHeight - tipRect.height - margin); }
    if (left < margin) { left = margin; }
    if (left + tipRect.width > viewportWidth - margin) { left = Math.max(margin, viewportWidth - tipRect.width - margin); }

    historyTooltipEl.style.left = Math.round(left) + 'px';
    historyTooltipEl.style.top = Math.round(top) + 'px';
    historyTooltipEl.setAttribute('data-placement', placement);
  }

  function bindHistoryRangeControls(details, today, providers) {
    var buttons = document.querySelectorAll('[data-usage-history-range]');
    Array.prototype.forEach.call(buttons, function(button) {
      button.addEventListener('click', function() {
        if (button.className.indexOf('unavailable') >= 0) { return; }
        var range = button.getAttribute('data-usage-history-range');
        var provider = button.getAttribute('data-history-provider') || 'claude';
        if (!range) { return; }
        if (provider === 'combined') {
          if (range === currentCombinedHistoryRange) { return; }
          currentCombinedHistoryRange = range;
        } else if (provider === 'claude') {
          if (range === currentClaudeHistoryRange) { return; }
          currentClaudeHistoryRange = range;
        } else {
          if (range === currentCodexHistoryRange) { return; }
          currentCodexHistoryRange = range;
        }
        renderUsageDetails(details || lastUsageDetails, today, providers);
      });
    });
  }

  function selectClaudeHistoryChartRange(chart, rangeKey) {
    return selectHistoryChartRange(chart, rangeKey, 'Claude');
  }

  function selectCodexHistoryChartRange(chart, rangeKey) {
    return selectHistoryChartRange(chart, rangeKey, 'Codex');
  }

  function selectCombinedHistoryChartRange(chart, rangeKey) {
    return selectHistoryChartRange(chart, rangeKey, 'combined Claude and Codex');
  }

  function selectHistoryChartRange(chart, rangeKey, providerLabel) {
    if (!chart) { return chart; }

    var selectedRange = normalizeAvailableHistoryRange(chart, rangeKey);
    var view = chart.rangeViews && chart.rangeViews[selectedRange];
    var points = view && view.points ? view.points : filterHistoryPointsByRange(chart.points || [], selectedRange);
    var maxTotalTokens = points.reduce(function(max, point) {
      return Math.max(max, Number(point.totalTokens || 0));
    }, view ? Number(view.maxTotalTokens || 0) : 0);

    var ranges = (chart.ranges || []).map(function(range) {
      if (!range) { return range; }
      var available = Boolean(range.available);
      if (range.key === '1D' || range.key === '1W' || range.key === '1M' || range.key === '1Y' || range.key === 'ALL') {
        available = Boolean(range.available && chart.available && chart.points && chart.points.length);
      }
      return {
        key: range.key,
        label: range.label,
        available: available,
        active: range.key === selectedRange
      };
    });

    var hasSourceData = historyPointsHaveSourceData(points);
    var unavailableReason = view && view.unavailableReason && !hasSourceData
      ? view.unavailableReason
      : points.length
        ? undefined
        : 'No ' + providerLabel + ' usage records for this calendar range.';
    var limitation = view && view.limitation ? view.limitation : undefined;

    return {
      available: Boolean(chart.available && points.length),
      key: selectedRange,
      title: chart.title || 'Token trend',
      rangeLabel: view && view.rangeLabel ? view.rangeLabel : claudeHistoryRangeLabel(selectedRange),
      unavailableReason: unavailableReason,
      ranges: ranges,
      points: points,
      maxTotalTokens: maxTotalTokens,
      granularity: view && view.granularity,
      granularityLabel: view && view.granularityLabel,
      axisLabel: view && view.axisLabel,
      ariaLabel: view && view.ariaLabel,
      activeBinCount: view && view.activeBinCount,
      activeUnitLabel: view && view.activeUnitLabel,
      limitation: limitation,
      source: chart.source
    };
  }

  function historyPointsHaveSourceData(points) {
    return (points || []).some(function(point) {
      return !point.isEmpty || Number(point.sourcePointCount || 0) > 0;
    });
  }

  function selectClaudeModelDistributionRange(distribution, chart, rangeKey) {
    return selectModelDistributionRange(distribution, chart, rangeKey, 'Claude');
  }

  function selectCodexModelDistributionRange(distribution, chart, rangeKey) {
    return selectModelDistributionRange(distribution, chart, rangeKey, 'Codex');
  }

  function selectModelDistributionRange(distribution, chart, rangeKey, label) {
    if (!distribution || !chart || !chart.available || !chart.points || !chart.points.length) {
      return distribution;
    }

    var selectedRange = normalizeClaudeHistoryRange(rangeKey);
    var selectedChart = selectHistoryChartRange(chart, selectedRange, label);
    var points = selectedChart && selectedChart.points ? selectedChart.points : [];

    if (!points.length) {
      return {
        available: false,
        title: distribution.title || 'Model distribution',
        rangeLabel: selectedChart && selectedChart.rangeLabel ? selectedChart.rangeLabel : claudeHistoryRangeLabel(selectedRange),
        totalTokens: 0,
        segments: [],
        unavailableReason: 'No ' + label + ' model distribution is available for this range.',
        source: distribution.source
      };
    }

    var aggregate = aggregateModelDistribution(points);
    var totalTokens = aggregate.reduce(function(sum, entry) { return sum + entry.totalTokens; }, 0);
    var baseDistributionTotal = distribution && Number(distribution.totalTokens || 0);

    if (totalTokens <= 0) {
      if (distribution.available && distribution.segments && distribution.segments.length) {
        return {
          available: true,
          title: distribution.title || label + ' model distribution',
          providerLabel: label,
          rangeLabel: selectedChart && selectedChart.rangeLabel ? selectedChart.rangeLabel : (distribution.rangeLabel || claudeHistoryRangeLabel(selectedRange)),
          totalTokens: distribution.totalTokens,
          segments: distribution.segments,
          source: distribution.source
        };
      }
      return {
        available: false,
        title: distribution.title || 'Model distribution',
        rangeLabel: selectedChart && selectedChart.rangeLabel ? selectedChart.rangeLabel : claudeHistoryRangeLabel(selectedRange),
        totalTokens: 0,
        segments: [],
        unavailableReason: 'No ' + label + ' model distribution is available for this range.',
        source: distribution.source
      };
    }

    if (distribution.available && distribution.segments && distribution.segments.length && isFinite(baseDistributionTotal) && baseDistributionTotal > totalTokens) {
      return {
        available: true,
        title: distribution.title || label + ' model distribution',
        providerLabel: label,
        rangeLabel: selectedChart && selectedChart.rangeLabel ? selectedChart.rangeLabel : (distribution.rangeLabel || claudeHistoryRangeLabel(selectedRange)),
        totalTokens: distribution.totalTokens,
        segments: distribution.segments,
        source: distribution.source
      };
    }

    return {
      available: true,
      title: distribution.title || label + ' model distribution',
      providerLabel: label,
      rangeLabel: selectedChart && selectedChart.rangeLabel ? selectedChart.rangeLabel : claudeHistoryRangeLabel(selectedRange),
      totalTokens: totalTokens,
      segments: aggregate.map(function(entry) {
        var percent = entry.totalTokens / totalTokens;
        return {
          label: entry.label,
          model: entry.model,
          totalTokens: entry.totalTokens,
          assistantMessages: entry.assistantMessages,
          percent: percent,
          percentLabel: formatPercentLabel(percent)
        };
      }),
      source: distribution.source
    };
  }

  function aggregateModelDistribution(points) {
    var byModel = {};
    points.forEach(function(point) {
      (point.models || []).forEach(function(model) {
        var key = model.model || model.label || 'unknown';
        if (!byModel[key]) {
          byModel[key] = {
            label: model.label || key,
            model: key,
            pricingModel: model.pricingModel || model.model || model.label || key,
            totalTokens: 0, inputTokens: 0, outputTokens: 0,
            cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 0
          };
        }
        byModel[key].totalTokens += Number(model.totalTokens || 0);
        byModel[key].inputTokens += Number(model.inputTokens || 0);
        byModel[key].outputTokens += Number(model.outputTokens || 0);
        byModel[key].cacheCreationInputTokens += Number(model.cacheCreationInputTokens || 0);
        byModel[key].cacheReadInputTokens += Number(model.cacheReadInputTokens || 0);
        byModel[key].assistantMessages += Number(model.assistantMessages || 0);
      });
    });

    var entries = Object.keys(byModel)
      .map(function(key) { return byModel[key]; })
      .filter(function(entry) { return entry.totalTokens > 0; })
      .sort(function(a, b) { return b.totalTokens - a.totalTokens; });

    var top = entries.slice(0, 5);
    var rest = entries.slice(5);
    if (!rest.length) { return top; }

    var other = rest.reduce(function(sum, entry) {
      sum.totalTokens += entry.totalTokens;
      sum.inputTokens += entry.inputTokens;
      sum.outputTokens += entry.outputTokens;
      sum.cacheCreationInputTokens += entry.cacheCreationInputTokens;
      sum.cacheReadInputTokens += entry.cacheReadInputTokens;
      sum.assistantMessages += entry.assistantMessages;
      return sum;
    }, { label: 'Other', model: 'Other', totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 0 });

    return other.totalTokens > 0 ? top.concat([other]) : top;
  }

  function filterHistoryPointsByRange(points, rangeKey) {
    var existing = (points || []).filter(function(p) { return p && p.dateKey; });
    if (!existing.length) { return []; }
    existing.sort(function(a, b) { return a.dateKey.localeCompare(b.dateKey); });
    var limit = claudeHistoryRangePointLimit(rangeKey);
    return existing.slice(-limit);
  }

  function normalizeAvailableHistoryRange(chart, rangeKey) {
    var normalized = normalizeClaudeHistoryRange(rangeKey);
    var ranges = chart && chart.ranges ? chart.ranges : [];
    var available = ranges.filter(function(range) { return range && range.available; });
    var requested = available.find(function(range) { return range.key === normalized; });
    if (requested) { return normalized; }
    var fallback = available.find(function(range) { return range.key === '1M'; }) || available[0];
    return fallback && fallback.key ? fallback.key : normalized;
  }

  function countActiveHistoryDays(points) {
    return (points || []).filter(function(point) {
      return Number(point.totalTokens || 0) > 0 || Number(point.assistantMessages || 0) > 0;
    }).length;
  }

  function claudeHistoryRangePointLimit(rangeKey) {
    switch (normalizeClaudeHistoryRange(rangeKey)) {
      case '1D': return 1;
      case '1W': return 7;
      case '1M': return 30;
      case '1Y': return 365;
      case 'ALL': return 365;
      default: return 30;
    }
  }

  function claudeHistoryRangeLabel(rangeKey) {
    switch (normalizeClaudeHistoryRange(rangeKey)) {
      case '1D': return '1D / today (day-level)';
      case '1W': return '1W / daily bins';
      case '1M': return '1M / daily bins';
      case '1Y': return '1Y / weekly bins';
      case 'ALL': return 'ALL / monthly bins (12M loaded)';
      default: return '1M / 30d';
    }
  }

  function normalizeClaudeHistoryRange(rangeKey) {
    if (rangeKey === '1D' || rangeKey === '1W' || rangeKey === '1M' || rangeKey === '1Y' || rangeKey === 'ALL') {
      return rangeKey;
    }
    return '1M';
  }

  function formatPercentLabel(value) {
    var numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) { return '0%'; }
    if (numeric < 0.01) { return '<1%'; }
    return Math.round(numeric * 100) + '%';
  }

  function selectCombinedHistoryMetricCardsRange(cards, chart, rangeKey) {
    var selectedRange = normalizeClaudeHistoryRange(rangeKey);
    var source = chart && chart.source;
    var points = chart && chart.points ? chart.points : [];
    var apiCard = buildCombinedApiEquivalentCard(selectedRange, source, points);

    if (!chart || !chart.available || !points.length) {
      return [
        buildRangeHistoryMetricCard('combinedHistoryActivity', rangeCardLabel(selectedRange, 'activity'), 'Unavailable', 'Provider activity unavailable', false, source),
        buildRangeHistoryMetricCard('combinedHistoryTokens', rangeCardLabel(selectedRange, 'tokens'), 'Unavailable', 'Provider totals unavailable', false, source),
        buildRangeHistoryMetricCard('combinedHistoryInputOutput', rangeCardLabel(selectedRange, 'inputOutput'), 'Unavailable', 'Provider input/output unavailable', false, source),
        buildRangeHistoryMetricCard('combinedHistoryCache', rangeCardLabel(selectedRange, 'cache'), 'Unavailable', 'Provider cache unavailable', false, source),
        apiCard
      ];
    }

    var totals = summarizeHistoryPoints(points);
    var providerTotals = summarizeCombinedProviderSegments(points);
    var activeBinCount = typeof chart.activeBinCount === 'number' ? chart.activeBinCount : countActiveHistoryDays(points);
    var activeUnitLabel = chart.activeUnitLabel || 'days';
    var claudeActiveBins = countProviderActiveBins(points, 'claude');
    var codexActiveBins = countProviderActiveBins(points, 'codex');

    return [
      buildRangeHistoryMetricCard('combinedHistoryActivity', rangeCardLabel(selectedRange, 'activity'),
        formatMetricNumber(totals.assistantMessages),
        formatProviderTotalDetail(providerTotals, 'assistantMessages'),
        true, source,
        formatProviderTotalDetailLines(providerTotals, 'assistantMessages')),
      buildRangeHistoryMetricCard('combinedHistoryTokens', rangeCardLabel(selectedRange, 'tokens'),
        formatMetricNumber(totals.totalTokens),
        formatProviderTotalDetail(providerTotals, 'totalTokens'),
        true, source,
        formatProviderTotalDetailLines(providerTotals, 'totalTokens')),
      buildRangeHistoryMetricCard('combinedHistoryInputOutput', rangeCardLabel(selectedRange, 'inputOutput'),
        formatMetricNumber(totals.inputTokens) + ' / ' + formatMetricNumber(totals.outputTokens),
        formatProviderInputOutputDetail(providerTotals),
        true, source,
        formatProviderInputOutputDetailLines(providerTotals)),
      buildRangeHistoryMetricCard('combinedHistoryCache', rangeCardLabel(selectedRange, 'cache'),
        formatMetricNumber(totals.cacheTokens),
        formatProviderTotalDetail(providerTotals, 'cacheTokens'),
        true, source,
        formatProviderTotalDetailLines(providerTotals, 'cacheTokens')),
      apiCard
    ];
  }

  function summarizeCombinedProviderSegments(points) {
    var totals = { claude: emptyProviderTotals(), codex: emptyProviderTotals() };
    (points || []).forEach(function(point) {
      (point.providerSegments || []).forEach(function(segment) {
        if (!segment || (segment.provider !== 'claude' && segment.provider !== 'codex')) { return; }
        var target = totals[segment.provider];
        target.totalTokens += Number(segment.totalTokens || 0);
        target.inputTokens += Number(segment.inputTokens || 0);
        target.outputTokens += Number(segment.outputTokens || 0);
        target.cacheTokens += Number(segment.cacheTokens || 0);
        target.cacheCreationTokens += Number(segment.cacheCreationTokens || 0);
        target.cacheReadTokens += Number(segment.cacheReadTokens || 0);
        target.assistantMessages += Number(segment.assistantMessages || 0);
      });
    });
    return totals;
  }

  function emptyProviderTotals() {
    return { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, assistantMessages: 0 };
  }

  function formatProviderTotalDetail(providerTotals, field) {
    return 'Claude ' + formatMetricNumber(providerTotals.claude[field]) + ' · Codex ' + formatMetricNumber(providerTotals.codex[field]);
  }

  function formatProviderInputOutputDetail(providerTotals) {
    return 'Claude ' + formatMetricNumber(providerTotals.claude.inputTokens) + ' / ' + formatMetricNumber(providerTotals.claude.outputTokens) +
      ' · Codex ' + formatMetricNumber(providerTotals.codex.inputTokens) + ' / ' + formatMetricNumber(providerTotals.codex.outputTokens);
  }

  function formatProviderTotalDetailLines(providerTotals, field) {
    return providerBreakdownLines(
      Number(providerTotals.claude[field] || 0),
      Number(providerTotals.codex[field] || 0),
      function(total) { return formatMetricNumber(total); }
    );
  }

  function formatProviderInputOutputDetailLines(providerTotals) {
    var claudeTotal = Number(providerTotals.claude.inputTokens || 0) + Number(providerTotals.claude.outputTokens || 0);
    var codexTotal = Number(providerTotals.codex.inputTokens || 0) + Number(providerTotals.codex.outputTokens || 0);
    return providerBreakdownLines(claudeTotal, codexTotal, function(_total, provider) {
      var totals = providerTotals[provider];
      return formatMetricNumber(totals.inputTokens) + ' / ' + formatMetricNumber(totals.outputTokens);
    });
  }

  function providerBreakdownLines(claudeTotal, codexTotal, formatValue) {
    var lines = [];
    if (claudeTotal > 0) { lines.push('Claude: ' + formatValue(claudeTotal, 'claude')); }
    if (codexTotal > 0) { lines.push('Codex: ' + formatValue(codexTotal, 'codex')); }
    return lines.length >= 2 ? lines : undefined;
  }

  function selectedPointDateBounds(selectedPoints) {
    var minDate = null, maxDate = null;
    (selectedPoints || []).forEach(function(p) {
      if (!p || !p.dateKey) { return; }
      var start = p.binStartDateKey || p.dateKey;
      var end = p.binEndDateKey || p.dateKey;
      if (minDate === null || start < minDate) { minDate = start; }
      if (maxDate === null || end > maxDate) { maxDate = end; }
    });
    return minDate && maxDate ? { minDate: minDate, maxDate: maxDate } : undefined;
  }

  function sourceDisplayLabel(point) {
    return point && point.sourceLabel ? point.sourceLabel : (point && point.source === 'local' ? 'Local' : 'Snapshot');
  }

  function computeSourceBreakdown(chart, selectedPoints) {
    if (!chart || !chart.points || !chart.points.length) { return undefined; }
    var hasSourceMarkers = chart.points.some(function(p) { return p && p.source; });
    if (!hasSourceMarkers) { return undefined; }
    var bounds = selectedPointDateBounds(selectedPoints);
    if (!bounds) { return undefined; }
    var bySource = {};
    chart.points.forEach(function(p) {
      if (!p || !p.source || !p.dateKey) { return; }
      if (p.dateKey < bounds.minDate || p.dateKey > bounds.maxDate) { return; }
      var key = sourceDisplayLabel(p);
      if (!bySource[key]) {
        bySource[key] = { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, assistantMessages: 0 };
      }
      bySource[key].totalTokens += Number(p.totalTokens || 0);
      bySource[key].inputTokens += Number(p.inputTokens || 0);
      bySource[key].outputTokens += Number(p.outputTokens || 0);
      bySource[key].cacheTokens += Number(p.cacheTokens || 0);
      bySource[key].cacheCreationTokens += Number(p.cacheCreationTokens || 0);
      bySource[key].cacheReadTokens += Number(p.cacheReadTokens || 0);
      bySource[key].assistantMessages += Number(p.assistantMessages || 0);
    });
    var keys = Object.keys(bySource).filter(function(k) { return bySource[k].totalTokens > 0 || bySource[k].assistantMessages > 0; });
    if (!keys.length) { return undefined; }
    return keys.map(function(k) { return { label: k, totals: bySource[k] }; });
  }

  function formatSourceBreakdownLines(breakdown, formatFn) {
    if (!breakdown || !breakdown.length) { return undefined; }
    return breakdown.map(function(entry) {
      return entry.label + ': ' + formatFn(entry.totals);
    });
  }

  function computeSourceApiEquivalentBreakdown(chart, selectedPoints, isClaude) {
    if (!chart || !chart.points || !chart.points.length) { return undefined; }
    var hasSourceMarkers = chart.points.some(function(p) { return p && p.source; });
    if (!hasSourceMarkers) { return undefined; }
    var bounds = selectedPointDateBounds(selectedPoints);
    if (!bounds) { return undefined; }
    var bySource = {};
    chart.points.forEach(function(p) {
      if (!p || !p.source || !p.dateKey) { return; }
      if (p.dateKey < bounds.minDate || p.dateKey > bounds.maxDate) { return; }
      var key = sourceDisplayLabel(p);
      if (!bySource[key]) {
        bySource[key] = {
          totals: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, assistantMessages: 0 },
          points: []
        };
      }
      bySource[key].totals.totalTokens += Number(p.totalTokens || 0);
      bySource[key].totals.inputTokens += Number(p.inputTokens || 0);
      bySource[key].totals.outputTokens += Number(p.outputTokens || 0);
      bySource[key].totals.cacheTokens += Number(p.cacheTokens || 0);
      bySource[key].totals.cacheCreationTokens += Number(p.cacheCreationTokens || 0);
      bySource[key].totals.cacheReadTokens += Number(p.cacheReadTokens || 0);
      bySource[key].totals.assistantMessages += Number(p.assistantMessages || 0);
      bySource[key].points.push(p);
    });
    var keys = Object.keys(bySource).filter(function(k) {
      var totals = bySource[k].totals;
      return totals.totalTokens > 0 || totals.assistantMessages > 0;
    });
    if (!keys.length) { return undefined; }

    var breakdown = [];
    for (var i = 0; i < keys.length; i++) {
      var entry = bySource[keys[i]];
      var modelUsage = aggregateModelUsageForEstimate(entry.points);
      var modelTokenTotal = modelUsage.reduce(function(sum, model) { return sum + Number(model.totalTokens || 0); }, 0);
      if (modelTokenTotal < entry.totals.totalTokens) { return undefined; }
      var estimate = estimateApiEquivalentFromModelUsage(modelUsage, isClaude);
      if (!estimate.available) { return undefined; }
      breakdown.push({ label: keys[i], costUsd: estimate.costUsd, isFallback: estimate.isFallback });
    }
    return breakdown.length ? breakdown : undefined;
  }

  function formatSourceApiEquivalentLines(breakdown) {
    if (!breakdown || !breakdown.length) { return undefined; }
    return breakdown.map(function(entry) {
      return entry.label + ': ' + formatMetricUsd(entry.costUsd);
    });
  }

  function countProviderActiveBins(points, provider) {
    return (points || []).filter(function(point) {
      return (point.providerSegments || []).some(function(segment) {
        return segment && segment.provider === provider &&
          (Number(segment.totalTokens || 0) > 0 || Number(segment.assistantMessages || 0) > 0);
      });
    }).length;
  }

  var CLAUDE_PRICING = {
    'claude-opus-4-7':   { inputPerMillion: 5,  outputPerMillion: 25 },
    'claude-opus-4-6':   { inputPerMillion: 5,  outputPerMillion: 25 },
    'claude-opus-4-5':   { inputPerMillion: 5,  outputPerMillion: 25 },
    'claude-opus-4-1':   { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-opus-4':     { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-3-opus':     { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-sonnet-4-6': { inputPerMillion: 3,  outputPerMillion: 15 },
    'claude-sonnet-4-5': { inputPerMillion: 3,  outputPerMillion: 15 },
    'claude-sonnet-4':   { inputPerMillion: 3,  outputPerMillion: 15 },
    'claude-3.5-sonnet': { inputPerMillion: 3,  outputPerMillion: 15 },
    'claude-haiku-4-5':  { inputPerMillion: 1,  outputPerMillion: 5 },
    'claude-haiku-3-5':  { inputPerMillion: 0.80, outputPerMillion: 4 }
  };
  var CODEX_PRICING = {
    'gpt-5.5':       { inputPerMillion: 5,    outputPerMillion: 30 },
    'gpt-5.4':       { inputPerMillion: 2.50, outputPerMillion: 15 },
    'gpt-5.4-mini':  { inputPerMillion: 0.75, outputPerMillion: 4.50 },
    'gpt-5.4-nano':  { inputPerMillion: 0.20, outputPerMillion: 1.25 },
    'gpt-5.3-codex': { inputPerMillion: 1.75, outputPerMillion: 14 },
    'codex-auto-review': { inputPerMillion: 1.75, outputPerMillion: 14 }
  };
  var CLAUDE_DEFAULT = { inputPerMillion: 3, outputPerMillion: 15 };
  var CODEX_DEFAULT = { inputPerMillion: 2.50, outputPerMillion: 15 };
  var CLAUDE_CACHE_READ_MULTIPLIER = 0.1;
  var CLAUDE_CACHE_WRITE_MULTIPLIER = 1.25;
  var CODEX_CACHE_READ_MULTIPLIER = 0.1;

  function matchPricing(modelName, table, defaultPricing) {
    var normalized = String(modelName || '').toLowerCase();
    var keys = Object.keys(table).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (normalized.indexOf(keys[i]) === 0) { return { pricing: table[keys[i]], matched: keys[i] }; }
    }
    return { pricing: defaultPricing, matched: undefined };
  }

  function computeCost(pricing, input, output, cacheRead, cacheWrite, readMult, writeMult) {
    var inputCost = (input / 1000000) * pricing.inputPerMillion;
    var outputCost = (output / 1000000) * pricing.outputPerMillion;
    var cacheReadCost = (cacheRead / 1000000) * pricing.inputPerMillion * readMult;
    var cacheWriteCost = (cacheWrite / 1000000) * pricing.inputPerMillion * writeMult;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  function computeOpenAiCost(pricing, input, output, cacheRead, cacheWrite) {
    var cachedInput = Math.min(input, cacheRead);
    var uncachedInput = Math.max(0, input - cachedInput);
    var cachedOnly = Math.max(0, cacheRead - input);
    var cacheWriteOnly = input > 0 ? 0 : cacheWrite;
    var inputCost = ((uncachedInput + cacheWriteOnly) / 1000000) * pricing.inputPerMillion;
    var cachedInputCost = ((cachedInput + cachedOnly) / 1000000) * pricing.inputPerMillion * CODEX_CACHE_READ_MULTIPLIER;
    var outputCost = (output / 1000000) * pricing.outputPerMillion;
    return inputCost + cachedInputCost + outputCost;
  }

  function estimateClaudeCost(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, models) {
    var result = (models && models.length > 0) ? matchPricing(models[0], CLAUDE_PRICING, CLAUDE_DEFAULT) : { pricing: CLAUDE_DEFAULT, matched: undefined };
    var costUsd = computeCost(result.pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, CLAUDE_CACHE_READ_MULTIPLIER, CLAUDE_CACHE_WRITE_MULTIPLIER);
    return { costUsd: costUsd, isFallback: !result.matched };
  }

  function estimateCodexCost(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, models) {
    var result = (models && models.length > 0) ? matchPricing(models[0], CODEX_PRICING, CODEX_DEFAULT) : { pricing: CODEX_DEFAULT, matched: undefined };
    var costUsd = computeOpenAiCost(result.pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
    return { costUsd: costUsd, isFallback: !result.matched };
  }

  function estimateApiEquivalentFromModelUsage(modelUsage, isClaude) {
    var entries = (modelUsage || []).filter(function(model) { return model && Number(model.totalTokens || 0) > 0; });
    if (!entries.length) { return { available: false, costUsd: 0, isFallback: false, fallbackCount: 0, totalCount: 0 }; }

    var fn = isClaude ? estimateClaudeCost : estimateCodexCost;
    var total = 0;
    var fallbackCount = 0;

    for (var i = 0; i < entries.length; i++) {
      var model = entries[i];
      var inputTokens = Number(model.inputTokens);
      var outputTokens = Number(model.outputTokens);
      var cacheReadTokens = Number(model.cacheReadInputTokens);
      var cacheWriteTokens = Number(model.cacheCreationInputTokens);
      if (![inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].every(function(v) { return isFinite(v) && v >= 0; })) {
        return { available: false, costUsd: 0, isFallback: false, fallbackCount: 0, totalCount: entries.length };
      }
      var result = fn(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, [model.pricingModel || model.model || model.label || '']);
      total += result.costUsd;
      if (result.isFallback) { fallbackCount += 1; }
    }

    return { available: total > 0, costUsd: total, isFallback: fallbackCount > 0, fallbackCount: fallbackCount, totalCount: entries.length };
  }

  function aggregateModelUsageForEstimate(points) {
    var byModel = {};
    (points || []).forEach(function(point) {
      (point.models || []).forEach(function(model) {
        var key = model.model || model.label || 'unknown';
        if (!byModel[key]) {
          byModel[key] = { label: model.label || key, model: key, pricingModel: model.pricingModel || model.model || model.label || key,
            totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        }
        byModel[key].totalTokens += Number(model.totalTokens || 0);
        byModel[key].inputTokens += Number(model.inputTokens || 0);
        byModel[key].outputTokens += Number(model.outputTokens || 0);
        byModel[key].cacheCreationInputTokens += Number(model.cacheCreationInputTokens || 0);
        byModel[key].cacheReadInputTokens += Number(model.cacheReadInputTokens || 0);
      });
    });
    return Object.keys(byModel).map(function(key) { return byModel[key]; });
  }

  function aggregateProviderModelUsageForEstimate(points) {
    var byProvider = { claude: [], codex: [] };
    (points || []).forEach(function(point) {
      (point.models || []).forEach(function(model) {
        var name = model.model || model.label || '';
        if (name.indexOf('Claude · ') === 0) {
          byProvider.claude.push(model);
        } else if (name.indexOf('Codex · ') === 0) {
          byProvider.codex.push(model);
        }
      });
    });
    return {
      claude: aggregateModelUsageForEstimate([{ models: byProvider.claude }]),
      codex: aggregateModelUsageForEstimate([{ models: byProvider.codex }])
    };
  }

  function apiEquivalentEstimateSource(label, detail) {
    return {
      confidence: 'apiEquivalentEstimate',
      label: label,
      detail: detail || 'Estimate from per-model token counts and published model pricing; not actual billing.'
    };
  }

  function formatApiEstimateTooltip(label, fallbackPricingUsed, unavailableReason) {
    var prefix = label + ' estimate';
    if (unavailableReason) {
      return prefix + ' unavailable: ' + unavailableReason + '. Not actual billing.';
    }
    return prefix + '; ' + (fallbackPricingUsed ? 'fallback pricing used; ' : '') + 'not actual billing.';
  }

  function buildCombinedApiEquivalentCard(rangeKey, source, points) {
    var cardSource = apiEquivalentEstimateSource('Combined API-equivalent estimate', 'Combined from selected-range provider API-equivalent estimates when available.');
    var label = rangeCardLabel(rangeKey, 'apiEquivalent');

    if (!points || !points.length) {
      return { key: 'combinedHistoryApiEquivalent', label: label, value: 'Unavailable', detail: 'Range estimate unavailable', available: false, source: cardSource };
    }

    var providerModelUsage = aggregateProviderModelUsageForEstimate(points);
    var claudeEst = estimateApiEquivalentFromModelUsage(providerModelUsage.claude, true);
    var codexEst = estimateApiEquivalentFromModelUsage(providerModelUsage.codex, false);
    var isFallback = claudeEst.isFallback || codexEst.isFallback;

    if (claudeEst.available && codexEst.available) {
      return { key: 'combinedHistoryApiEquivalent', label: label, value: formatMetricUsd(claudeEst.costUsd + codexEst.costUsd), detail: isFallback ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
        detailLines: ['Claude: ' + formatMetricUsd(claudeEst.costUsd), 'Codex: ' + formatMetricUsd(codexEst.costUsd)],
        detailTooltip: formatApiEstimateTooltip(label, isFallback), available: true, source: cardSource };
    }
    if (claudeEst.available || codexEst.available) {
      return { key: 'combinedHistoryApiEquivalent', label: label, value: 'Unavailable',
        detail: 'Estimate requires per-model token data from all providers',
        detailTooltip: formatApiEstimateTooltip(label, false, 'every contributing provider must include per-model token data'),
        available: false, source: cardSource };
    }
    return { key: 'combinedHistoryApiEquivalent', label: label, value: 'Unavailable', detail: 'Provider estimates unavailable',
      detailTooltip: formatApiEstimateTooltip(label, false, 'no token data is available'), available: false, source: cardSource };
  }

  function selectCombinedModelDistributionRange(details, chart, rangeKey) {
    var selectedRange = normalizeClaudeHistoryRange(rangeKey);
    var source = (chart && chart.source) || (details && details.combinedHistoryChart && details.combinedHistoryChart.source);
    var points = chart && chart.points ? chart.points : [];

    if (!chart || !chart.available || !points.length) {
      return { available: false, title: 'Model distribution',
        rangeLabel: chart && chart.rangeLabel ? chart.rangeLabel : claudeHistoryRangeLabel(selectedRange),
        totalTokens: 0, segments: [],
        unavailableReason: 'No combined model distribution is available for this range.', source: source };
    }

    var aggregate = aggregateCombinedModelDistribution(points);
    var totalTokens = aggregate.reduce(function(sum, entry) { return sum + entry.totalTokens; }, 0);

    if (totalTokens <= 0) {
      return { available: false, title: 'Model distribution',
        rangeLabel: chart.rangeLabel || claudeHistoryRangeLabel(selectedRange),
        totalTokens: 0, segments: [],
        unavailableReason: 'No combined model distribution is available for this range.', source: source };
    }

    return {
      available: true, title: 'Model distribution',
      rangeLabel: chart.rangeLabel || claudeHistoryRangeLabel(selectedRange),
      totalTokens: totalTokens,
      segments: aggregate.map(function(entry) {
        var percent = entry.totalTokens / totalTokens;
        return { label: entry.label, model: entry.model, totalTokens: entry.totalTokens, assistantMessages: entry.assistantMessages, percent: percent, percentLabel: formatPercentLabel(percent) };
      }),
      source: source
    };
  }

  function aggregateCombinedModelDistribution(points) {
    var byModel = {};
    (points || []).forEach(function(point) {
      (point.models || []).forEach(function(model) {
        var key = model.model || model.label || 'unknown';
        if (!byModel[key]) { byModel[key] = { label: model.label || key, model: key, totalTokens: 0, assistantMessages: 0 }; }
        byModel[key].totalTokens += Number(model.totalTokens || 0);
        byModel[key].assistantMessages += Number(model.assistantMessages || 0);
      });
    });
    return Object.keys(byModel)
      .map(function(key) { return byModel[key]; })
      .filter(function(entry) { return entry.totalTokens > 0; })
      .sort(function(a, b) { return b.totalTokens - a.totalTokens; });
  }

  function selectClaudeHistoryMetricCardsRange(cards, chart, rangeKey) {
    if (!chart || !chart.available || !chart.points || !chart.points.length) { return cards || []; }

    var selectedRange = normalizeClaudeHistoryRange(rangeKey);
    var selectedChart = selectHistoryChartRange(chart, selectedRange, 'Claude');
    selectedRange = selectedChart && selectedChart.key ? selectedChart.key : selectedRange;
    var points = selectedChart && selectedChart.points ? selectedChart.points : [];
    if (!points.length) { return cards || []; }

    var totals = summarizeHistoryPoints(points);
    var rangeLabel = selectedChart.rangeLabel || claudeHistoryRangeLabel(selectedRange);
    var activeDayCount = typeof selectedChart.activeBinCount === 'number' ? selectedChart.activeBinCount : countActiveHistoryDays(points);
    var activeUnitLabel = selectedChart.activeUnitLabel || 'days';
    var allModels = aggregateModelDistribution(points);
    var topModel = allModels[0];
    var activityDetail = allModels.length === 0
      ? 'See model distribution'
      : allModels.length === 1
        ? '1 model · Top: ' + topModel.label
        : allModels.length + ' models · Top: ' + topModel.label;

    var modelUsageForEstimate = aggregateModelUsageForEstimate(points);
    var modelTokenTotal = modelUsageForEstimate.reduce(function(sum, m) { return sum + Number(m.totalTokens || 0); }, 0);
    var apiEst = modelTokenTotal >= totals.totalTokens
      ? estimateApiEquivalentFromModelUsage(modelUsageForEstimate, true)
      : { available: false, costUsd: 0, isFallback: false, fallbackCount: 0, totalCount: modelUsageForEstimate.length };
    var apiSource = apiEquivalentEstimateSource('Claude history API-equivalent estimate');

    var sourceBreakdown = computeSourceBreakdown(chart, points);
    var sourceApiEquivalentLines = apiEst.available
      ? formatSourceApiEquivalentLines(computeSourceApiEquivalentBreakdown(chart, points, true))
      : undefined;

    return [
      buildRangeHistoryMetricCard('historyActivity', rangeCardLabel(selectedRange, 'activity'), formatMetricNumber(totals.assistantMessages), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.assistantMessages); })),
      buildRangeHistoryMetricCard('historyTokens', rangeCardLabel(selectedRange, 'tokens'), formatMetricNumber(totals.totalTokens), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.totalTokens); })),
      buildRangeHistoryMetricCard('historyInputOutput', rangeCardLabel(selectedRange, 'inputOutput'),
        formatMetricNumber(totals.inputTokens) + ' / ' + formatMetricNumber(totals.outputTokens),
        '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.inputTokens) + ' / ' + formatMetricNumber(t.outputTokens); })),
      buildRangeHistoryMetricCard('historyCache', rangeCardLabel(selectedRange, 'cache'), formatMetricNumber(totals.cacheTokens), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.cacheTokens); })),
      buildRangeHistoryMetricCard('historyApiEquivalent', rangeCardLabel(selectedRange, 'apiEquivalent'),
        apiEst.available ? formatMetricUsd(apiEst.costUsd) : 'Unavailable',
        apiEst.available ? (apiEst.isFallback ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing')
          : (modelTokenTotal > 0 && modelTokenTotal < totals.totalTokens ? 'Unavailable for merged snapshot data' : 'No token data to estimate API-equivalent cost'),
        apiEst.available, apiSource, sourceApiEquivalentLines,
        formatApiEstimateTooltip('Claude ' + rangeCardLabel(selectedRange, 'apiEquivalent'), apiEst.isFallback,
          apiEst.available ? undefined : 'selected-range model token totals must cover all tokens'))
    ];
  }

  function selectCodexHistoryMetricCardsRange(cards, chart, rangeKey) {
    if (!chart || !chart.available || !chart.points || !chart.points.length) { return cards || []; }

    var selectedRange = normalizeClaudeHistoryRange(rangeKey);
    var selectedChart = selectHistoryChartRange(chart, selectedRange, 'Codex');
    selectedRange = selectedChart && selectedChart.key ? selectedChart.key : selectedRange;
    var points = selectedChart && selectedChart.points ? selectedChart.points : [];
    if (!points.length) { return cards || []; }

    var totals = summarizeHistoryPoints(points);
    var rangeLabel = selectedChart.rangeLabel || claudeHistoryRangeLabel(selectedRange);
    var activeDayCount = typeof selectedChart.activeBinCount === 'number' ? selectedChart.activeBinCount : countActiveHistoryDays(points);
    var activeUnitLabel = selectedChart.activeUnitLabel || 'days';
    var allModels = aggregateModelDistribution(points);
    var topModel = allModels[0];
    var activityDetail = allModels.length === 0
      ? 'See model distribution'
      : allModels.length === 1
        ? '1 model · Top: ' + topModel.label
        : allModels.length + ' models · Top: ' + topModel.label;

    var modelUsageForEstimate = aggregateModelUsageForEstimate(points);
    var modelTokenTotal = modelUsageForEstimate.reduce(function(sum, m) { return sum + Number(m.totalTokens || 0); }, 0);
    var codexApiEst = modelTokenTotal >= totals.totalTokens
      ? estimateApiEquivalentFromModelUsage(modelUsageForEstimate, false)
      : { available: false, costUsd: 0, isFallback: false, fallbackCount: 0, totalCount: modelUsageForEstimate.length };
    var codexApiSource = apiEquivalentEstimateSource('Codex history API-equivalent estimate');

    var sourceBreakdown = computeSourceBreakdown(chart, points);
    var sourceApiEquivalentLines = codexApiEst.available
      ? formatSourceApiEquivalentLines(computeSourceApiEquivalentBreakdown(chart, points, false))
      : undefined;

    return [
      buildRangeHistoryMetricCard('codexHistoryActivity', codexRangeCardLabel(selectedRange, 'activity'), formatMetricNumber(totals.assistantMessages), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.assistantMessages); })),
      buildRangeHistoryMetricCard('codexHistoryTokens', codexRangeCardLabel(selectedRange, 'tokens'), formatMetricNumber(totals.totalTokens), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.totalTokens); })),
      buildRangeHistoryMetricCard('codexHistoryInputOutput', codexRangeCardLabel(selectedRange, 'inputOutput'),
        formatMetricNumber(totals.inputTokens) + ' / ' + formatMetricNumber(totals.outputTokens),
        '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.inputTokens) + ' / ' + formatMetricNumber(t.outputTokens); })),
      buildRangeHistoryMetricCard('codexHistoryCache', codexRangeCardLabel(selectedRange, 'cache'), formatMetricNumber(totals.cacheTokens), '', true, chart.source,
        formatSourceBreakdownLines(sourceBreakdown, function(t) { return formatMetricNumber(t.cacheTokens); })),
      buildRangeHistoryMetricCard('codexHistoryApiEquivalent', codexRangeCardLabel(selectedRange, 'apiEquivalent'),
        codexApiEst.available ? formatMetricUsd(codexApiEst.costUsd) : 'Unavailable',
        codexApiEst.available ? (codexApiEst.isFallback ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing')
          : (modelTokenTotal > 0 && modelTokenTotal < totals.totalTokens ? 'Unavailable for merged snapshot data' : 'No token data to estimate API-equivalent cost'),
        codexApiEst.available, codexApiSource, sourceApiEquivalentLines,
        formatApiEstimateTooltip('Codex ' + codexRangeCardLabel(selectedRange, 'apiEquivalent'), codexApiEst.isFallback,
          codexApiEst.available ? undefined : 'selected-range model token totals must cover all tokens'))
    ];
  }

  function codexRangeCardLabel(rangeKey, kind) {
    var prefix = normalizeClaudeHistoryRange(rangeKey);
    switch (kind) {
      case 'history': return prefix + ' history';
      case 'tokens': return prefix + ' tokens';
      case 'inputOutput': return prefix + ' Input / Output';
      case 'activity': return prefix + ' Messages/Turns';
      case 'cache': return prefix + ' cache';
      case 'apiEquivalent': return prefix + ' API-equivalent';
      default: return prefix;
    }
  }

  function summarizeHistoryPoints(points) {
    return points.reduce(function(totals, point) {
      totals.totalTokens += Number(point.totalTokens || 0);
      totals.inputTokens += Number(point.inputTokens || 0);
      totals.outputTokens += Number(point.outputTokens || 0);
      totals.cacheTokens += Number(point.cacheTokens || 0);
      totals.cacheCreationTokens += Number(point.cacheCreationTokens || 0);
      totals.cacheReadTokens += Number(point.cacheReadTokens || 0);
      totals.assistantMessages += Number(point.assistantMessages || 0);
      return totals;
    }, { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, assistantMessages: 0 });
  }

  function buildRangeHistoryMetricCard(key, label, value, detail, available, source, detailLines, detailTooltip) {
    var card = { key: key, label: label, value: value, detail: detail, available: available, source: source };
    if (detailLines && detailLines.length) { card.detailLines = detailLines; }
    if (detailTooltip) { card.detailTooltip = detailTooltip; }
    return card;
  }

  function rangeCardLabel(rangeKey, kind) {
    var prefix = normalizeClaudeHistoryRange(rangeKey);
    switch (kind) {
      case 'history': return prefix + ' history';
      case 'tokens': return prefix + ' tokens';
      case 'inputOutput': return prefix + ' Input / Output';
      case 'activity': return prefix + ' Messages/Turns';
      case 'cache': return prefix + ' cache';
      case 'apiEquivalent': return prefix + ' API-equivalent';
      default: return prefix;
    }
  }

  function renderUsageMetricCard(card, parentSource) {
    var unavailableClass = card && card.available ? '' : ' unavailable';
    var chip = renderMetricSourceChip(card && card.source, parentSource);
    var detailTitle = card && card.detailTooltip ? ' title="' + esc(card.detailTooltip) + '"' : '';
    return '<section class="usage-metric-card' + unavailableClass + '">' +
      '<div class="usage-metric-label"><span class="usage-metric-label-text">' + esc(card.label || 'Metric') + '</span>' + chip + '</div>' +
      '<div class="usage-metric-value">' + esc(card.value || 'Unavailable') + '</div>' +
      '<div class="usage-metric-detail"' + detailTitle + '>' + renderMetricDetail(card) + '</div>' +
    '</section>';
  }

  function renderMetricDetail(card) {
    var detailLines = renderMetricDetailLines(card);
    return detailLines || esc(card && card.detail || '');
  }

  function renderMetricDetailLines(card) {
    if (!card || !Array.isArray(card.detailLines) || !card.detailLines.length) { return ''; }
    return card.detailLines.map(function(line) { return esc(line); }).join('<br>');
  }

  function renderUsageDetailsProvider(provider) {
    var unavailableClass = provider && provider.available ? '' : ' unavailable';
    var subtitle = provider.model || provider.workspace || 'model/workspace unknown';
    return '<section class="usage-details-provider' + unavailableClass + '">' +
      '<div class="usage-details-provider-head">' +
        '<div>' +
          '<div class="usage-details-provider-title">' + esc(provider.label || provider.provider || 'Provider') + '</div>' +
          '<div class="usage-details-provider-sub">' + esc(subtitle) + '</div>' +
        '</div>' +
      '</div>' +
      renderUsageDetailsRow('Current tokens', formatMetricNumber(provider.currentTokens)) +
      renderUsageDetailsRow('Total tokens', formatMetricNumber(provider.totalTokens)) +
      renderUsageDetailsRow('Input', formatMetricNumber(provider.inputTokens)) +
      renderUsageDetailsRow('Output', formatMetricNumber(provider.outputTokens)) +
      renderUsageDetailsRow('Cache read', formatMetricNumber(provider.cacheReadTokens)) +
      renderUsageDetailsRow('Cache write', formatMetricNumber(provider.cacheWriteTokens)) +
      renderUsageDetailsRow('Reasoning', formatMetricNumber(provider.reasoningTokens)) +
      renderUsageDetailsRow('API equiv.', formatMetricUsd(provider.apiEquivalentCostUsd)) +
    '</section>';
  }

  function renderUsageDetailsRow(label, value) {
    return '<div class="usage-details-row"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
  }

  function addThousandsSeparators(numStr) {
    var parts = numStr.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function formatMetricNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) { return '—'; }
    if (n >= 1000000) { return addThousandsSeparators((n / 1000000).toFixed(1)) + 'M'; }
    if (n >= 1000) { return addThousandsSeparators((n / 1000).toFixed(1)) + 'K'; }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatMetricUsd(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) { return '—'; }
    return '$' + addThousandsSeparators(n >= 100 ? n.toFixed(0) : n.toFixed(2));
  }

  function scopeProvidersByTab(providers, tab) {
    // At-a-glance always shows every source row as-is; split/combined never affects it.
    if (tab === 'overview') { return providers || []; }
    return (providers || []).filter(function(p) { return p && p.provider === tab; });
  }

  function dashboardAggregateProviders(providers) {
    var seen = {};
    var result = [];
    (providers || []).forEach(function(provider) {
      var key = provider && provider.provider;
      if ((key === 'claude' || key === 'codex') && !seen[key]) {
        seen[key] = true;
        result.push(key);
      }
    });
    return result;
  }

  function isProviderSourceSplitAvailable(providers) {
    return Boolean(providers && providers.filter(Boolean).length > 1);
  }

  function combineProviderSourceRows(providers) {
    var byProvider = {};
    (providers || []).forEach(function(provider) {
      if (!provider) { return; }
      var key = provider.provider || provider.label || 'provider';
      if (!byProvider[key]) {
        byProvider[key] = Object.assign({}, provider, {
          label: provider.provider === 'codex' ? 'Codex' : provider.provider === 'claude' ? 'Claude' : provider.label,
          machineLabel: undefined,
          windows: provider.windows || [],
          mergedSourceCount: 1
        });
        return;
      }
      var existing = byProvider[key];
      existing.stale = Boolean(existing.stale || provider.stale);
      existing.mergedSourceCount += 1;
      existing.windows = mergeProviderWindows(existing.windows || [], provider.windows || []);
    });
    return Object.keys(byProvider).map(function(key) { return byProvider[key]; });
  }

  function mergeProviderWindows(left, right) {
    var byKey = {};
    (left || []).concat(right || []).forEach(function(window) {
      if (!window || !window.key) { return; }
      var existing = byKey[window.key];
      if (!existing || Number(window.usedPercent || -1) > Number(existing.usedPercent || -1)) {
        byKey[window.key] = window;
      }
    });
    return ['sevenDay', 'fiveHour', 'sevenDayOpus']
      .map(function(key) { return byKey[key]; })
      .filter(Boolean);
  }

  function scopeTodayByTab(today, tab) {
    if (!today || !today.cards || tab === 'overview') { return today; }
    var providerCardFilter = function(c) {
      if (tab === 'claude') { return c && c.key && c.key.indexOf('codexToday') !== 0 && c.key.indexOf('remoteTodayCodex') !== 0; }
      if (tab === 'codex') { return c && c.key && (c.key.indexOf('codexToday') === 0 || c.key.indexOf('remoteTodayCodex') === 0); }
      return true;
    };
    var filteredCards = today.cards.filter(providerCardFilter);
    var filteredSplitCards = today.splitCards ? today.splitCards.filter(providerCardFilter) : undefined;
    return Object.assign({}, today, { cards: filteredCards, splitCards: filteredSplitCards, overviewCards: undefined });
  }

  function scopeDetailsByTab(details, tab) {
    if (!details) { return details; }
    if (tab === 'overview') {
      // Overview split is provider-level only; source panels belong to provider tabs.
      return Object.assign({}, details, {
        claudeSourceHistoryPanels: undefined,
        codexSourceHistoryPanels: undefined,
        claudeSourceModelDistributionPanels: undefined,
        codexSourceModelDistributionPanels: undefined
      });
    }
    if (tab === 'claude') {
      return Object.assign({}, details, {
        codexHistoryChart: undefined,
        codexModelDistribution: undefined,
        combinedHistoryChart: undefined,
        codexHistorySectionLabel: undefined,
        codexModelDistributionSectionLabel: undefined,
        combinedHistorySectionLabel: undefined,
        combinedModelDistributionSectionLabel: undefined,
        codexSourceHistoryPanels: undefined,
        codexSourceModelDistributionPanels: undefined,
        providers: (details.providers || []).filter(function(p) { return p && p.provider === 'claude'; })
      });
    }
    if (tab === 'codex') {
      return Object.assign({}, details, {
        historyChart: undefined,
        modelDistribution: undefined,
        combinedHistoryChart: undefined,
        claudeHistorySectionLabel: undefined,
        claudeModelDistributionSectionLabel: undefined,
        combinedHistorySectionLabel: undefined,
        combinedModelDistributionSectionLabel: undefined,
        claudeSourceHistoryPanels: undefined,
        claudeSourceModelDistributionPanels: undefined,
        providers: (details.providers || []).filter(function(p) { return p && p.provider === 'codex'; })
      });
    }
    return details;
  }

  function renderUsageDashboardSections(model) {
    var tabKey = currentUsageProviderTab;
    var providers = scopeProvidersByTab(model.providers, tabKey);
    var scopedToday = scopeTodayByTab(model.today, tabKey);
    var scopedDetails = scopeDetailsByTab(model.details, tabKey);
    renderDashboardForSources({
      tabKey: tabKey,
      label: dashboardTabLabel(model, tabKey),
      providers: providers,
      today: scopedToday,
      details: scopedDetails
    });
  }

  function dashboardTabLabel(model, tabKey) {
    var tab = model && model.tabs && model.tabs.find(function(t) { return t && t.key === tabKey; });
    if (tab && tab.label) { return tab.label; }
    if (tabKey === 'claude') { return 'Claude'; }
    if (tabKey === 'codex') { return 'Codex'; }
    return 'Overview';
  }

  function renderDashboardForSources(ctx) {
    var providers = ctx && ctx.providers || [];
    var cards = byId('usageDashboardCards');
    if (cards) {
      cards.className = 'usage-provider-grid';
      cards.innerHTML = renderGlanceList(providers);
    }
    renderSourceModeControls(ctx);
    renderAtAGlanceTitle(sectionSourceFromProviderWindows(providers));
    renderUsageToday(ctx && ctx.today);
    renderUsageDetails(ctx && ctx.details, ctx && ctx.today, providers);
  }

  function renderSourceModeControls(model) {
    var el = byId('usageSourceModeControls');
    if (el) { el.innerHTML = ''; }
  }

  function renderUsageToday(today) {
    var el = byId('usageToday');
    if (el) { el.innerHTML = ''; }
  }

  function buildTodayGroups(cards, isOverview, today) {
    var groups = [];
    if (isOverview) {
      var claudeCards = (cards || []).filter(function(c) {
        return c && c.key && c.key.indexOf('codexToday') !== 0 && c.key.indexOf('remoteTodayCodex') !== 0;
      });
      var codexCards = (cards || []).filter(function(c) {
        return c && c.key && (c.key.indexOf('codexToday') === 0 || c.key.indexOf('remoteTodayCodex') === 0);
      });
      // Only show a provider group when it has a real data source (sectionLabel defined).
      // Suppress "no activity" placeholders in overview when the other provider has real data.
      var hasRealClaude = !!(today && today.claudeSectionLabel);
      var hasRealCodex = !!(today && today.codexSectionLabel);
      var showAll = !hasRealClaude && !hasRealCodex;
      if (claudeCards.length > 0 && (hasRealClaude || showAll)) { groups.push({ label: (today && today.claudeSectionLabel) || 'Claude', cards: claudeCards }); }
      if (codexCards.length > 0 && (hasRealCodex || showAll)) { groups.push({ label: (today && today.codexSectionLabel) || 'Codex', cards: codexCards }); }
    } else {
      var remotePrefix = currentUsageProviderTab === 'claude' ? 'remoteTodayClaude' : 'remoteTodayCodex';
      var providerName = currentUsageProviderTab === 'claude' ? 'Claude' : 'Codex';
      var localCards = (cards || []).filter(function(c) { return c && c.key && c.key.indexOf(remotePrefix) !== 0; });
      var remoteCards = (cards || []).filter(function(c) { return c && c.key && c.key.indexOf(remotePrefix) === 0; });
      var sectionLabel = currentUsageProviderTab === 'claude'
        ? ((today && today.claudeSectionLabel) || 'Claude')
        : ((today && today.codexSectionLabel) || 'Codex');
      var remoteLabel = sectionLabel.replace(new RegExp('^' + providerName + ' \+ '), '') || 'Snapshot';
      if (remoteLabel === sectionLabel) { remoteLabel = 'Snapshot'; }
      if (localCards.length > 0) { groups.push({ label: providerName, cards: localCards }); }
      if (remoteCards.length > 0) { groups.push({ label: remoteLabel, cards: remoteCards }); }
    }
    return groups;
  }

  function renderProviderUnavailable(message, reason) {
    return '<div class="usage-provider-unavailable">' +
      '<div class="usage-provider-unavailable-title">' + esc(message || 'Unavailable') + '</div>' +
      '<div class="usage-provider-unavailable-reason">' + esc(reason || '') + '</div>' +
    '</div>';
  }

  function renderUsageDashboard(model) {
    var cards = byId('usageDashboardCards');
    if (!cards) { return; }
    setUsageLoading(false);

    lastUsageDashboardModel = model;

    if (model && model.tabs && !model.tabs.some(function(t) { return t.key === currentUsageProviderTab; })) {
      currentUsageProviderTab = 'overview';
    }

    if (!model || !model.providers || !model.providers.length) {
      currentUsageProviderTab = 'overview';
      cards.className = 'usage-provider-grid';
      renderSourceModeControls(undefined);
      renderAtAGlanceTitle();
      cards.innerHTML = '<div class="usage-empty">No provider usage state is available yet.</div>';
      renderUsageToday(undefined);
      renderUsageDetails(undefined);
      return;
    }

    renderUsageDashboardSections(model);
  }

  function renderGlanceList(providers) {
    if (!providers || !providers.length) {
      return '<div class="usage-empty">No provider usage state is available yet.</div>';
    }
    return '<div class="usage-glance-list">' + providers.map(renderGlanceRow).join('') + '</div>';
  }

  function renderGlanceRow(provider) {
    var staleClass = provider.stale ? ' stale' : '';
    var label = provider.label || (provider.provider === 'claude' ? 'Claude' : 'Codex');
    var badge = provider.stale ? 'stale' : (provider.mergedSourceCount > 1 ? 'merged' : (provider.machineLabel ? 'snapshot' : 'current'));
    var badgeStaleClass = provider.stale ? ' stale' : '';
    var windows = provider.windows || [];
    var cells = renderGlanceWindowCells(glanceWindowByKey(windows, 'sevenDay'), '7d') +
      renderGlanceWindowCells(glanceWindowByKey(windows, 'fiveHour'), '5h');

    return '<div class="usage-glance-row' + staleClass + '" data-glance-row="provider">' +
      '<div class="usage-glance-cell usage-glance-label usage-glance-col-provider" data-glance-col="provider" title="' + escAttr(label) + '">' + esc(label) + '</div>' +
      cells +
      '<div class="usage-glance-cell usage-glance-badge usage-glance-col-status' + badgeStaleClass + '" data-glance-col="status">' + esc(badge) + '</div>' +
    '</div>';
  }

  function glanceWindowByKey(windows, key) {
    for (var i = 0; i < windows.length; i += 1) {
      if (windows[i] && windows[i].key === key) { return windows[i]; }
    }
    return undefined;
  }

  function renderGlanceWindowCells(window, prefix) {
    var label = window && window.label ? window.label : '';
    if (!window) {
      return '<span class="usage-glance-cell usage-glance-win-label usage-glance-col-' + prefix + '-label" data-glance-col="' + prefix + '-label"></span>' +
        '<div class="usage-glance-cell usage-glance-bar-cell usage-glance-col-' + prefix + '-bar" data-glance-col="' + prefix + '-bar"><div class="usage-glance-bar usage-progress"></div></div>' +
        '<span class="usage-glance-cell usage-glance-win-value usage-glance-col-' + prefix + '-percent" data-glance-col="' + prefix + '-percent"></span>' +
        '<span class="usage-glance-cell usage-glance-win-reset usage-glance-col-' + prefix + '-reset" data-glance-col="' + prefix + '-reset"></span>';
    }
    if (!window || !window.available) {
      return '<span class="usage-glance-cell usage-glance-win-label usage-glance-col-' + prefix + '-label" data-glance-col="' + prefix + '-label">' + esc(label) + '</span>' +
        '<div class="usage-glance-cell usage-glance-bar-cell usage-glance-col-' + prefix + '-bar" data-glance-col="' + prefix + '-bar"><div class="usage-glance-bar usage-progress"><div class="usage-progress-fill" style="width:0%"></div></div></div>' +
        '<span class="usage-glance-cell usage-glance-win-value usage-glance-col-' + prefix + '-percent" data-glance-col="' + prefix + '-percent">—</span>' +
        '<span class="usage-glance-cell usage-glance-win-reset usage-glance-col-' + prefix + '-reset" data-glance-col="' + prefix + '-reset"></span>';
    }
    var remaining = clampPercent(window.remainingPercent);
    var levelClass = window.level ? ' level-' + window.level : '';
    var resetTime = window.resetIso
      ? new Date(window.resetIso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : '';

    return '<span class="usage-glance-cell usage-glance-win-label usage-glance-col-' + prefix + '-label" data-glance-col="' + prefix + '-label">' + esc(label) + '</span>' +
      '<div class="usage-glance-cell usage-glance-bar-cell usage-glance-col-' + prefix + '-bar" data-glance-col="' + prefix + '-bar">' +
        '<div class="usage-glance-bar usage-progress"><div class="usage-progress-fill' + levelClass + '" style="width:' + remaining + '%"></div></div>' +
      '</div>' +
      '<span class="usage-glance-cell usage-glance-win-value usage-glance-col-' + prefix + '-percent" data-glance-col="' + prefix + '-percent">' + Math.round(remaining) + '%</span>' +
      '<span class="usage-glance-cell usage-glance-win-reset usage-glance-col-' + prefix + '-reset" data-glance-col="' + prefix + '-reset">' + esc(resetTime) + '</span>';
  }

  function renderAtAGlanceTitle(source) {
    var title = byId('usageAtAGlanceTitle');
    if (title) {
      title.innerHTML = renderUsageSectionTitle('h3', 'usage-section-title', 'At a glance', source);
    }
  }

  function sectionSourceFromProviderWindows(providers) {
    if (!providers || !providers.length) { return undefined; }
    for (var i = 0; i < providers.length; i += 1) {
      var windows = providers[i] && providers[i].windows;
      if (!windows) { continue; }
      for (var j = 0; j < windows.length; j += 1) {
        if (windows[j] && windows[j].source) { return windows[j].source; }
      }
    }
    return undefined;
  }

  function clampPercent(value) {
    var n = Number(value);
    if (!isFinite(n)) { return 0; }
    return Math.max(0, Math.min(100, n));
  }

  // Init
  var refreshUsageBtn = byId('refreshUsageBtn');
  if (refreshUsageBtn) {
    refreshUsageBtn.addEventListener('click', requestUsageRefresh);
  }

  setupTabs();

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.command === 'focusTab') {
      activateProviderTab('overview');
    } else if (msg.command === 'refreshUsageStarted') {
      setUsageRefreshStatus('Refreshing usage…');
      setUsageLoading(true);
    } else if (msg.command === 'refreshUsageResult') {
      setUsageLoading(false);
      if (msg.success) {
        var refreshedAt = msg.refreshedAtIso ? new Date(msg.refreshedAtIso).toLocaleTimeString() : 'now';
        setUsageRefreshStatus('Usage refreshed at ' + refreshedAt + '. Status bar values were updated.');
      } else {
        setUsageRefreshStatus('Usage refresh failed. Existing status bar values were left unchanged.');
      }
    } else if (msg.command === 'usageDashboardModel') {
      renderUsageDashboard(msg.model);
    } else if (msg.command === 'usageDashboardModelError') {
      setUsageLoading(false);
      setUsageRefreshStatus('Usage dashboard model could not be rendered: ' + esc(msg.error || 'unknown error'));
    }
  });
})();
