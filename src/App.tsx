import { useEffect, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'sigma-sell-calculator-v4'
const LOCAL_OPTIONS_CHAIN_ENDPOINT = '/api/options-chain'
const REMOTE_OPTIONS_CHAIN_ENDPOINT =
  import.meta.env.VITE_OPTIONS_CHAIN_ENDPOINT?.trim() ||
  'https://www.gosalci.com/api/options-chain'
const OPTIONS_CHAIN_SOURCE = 'manual'

const STOCK_OPTIONS = [
  'NVDA',
  'AAPL',
  'AMD',
  'INTC',
  'META',
  'MSFT',
  'SPY',
  'TSLA',
  'QQQ',
] as const
const LEVERAGE_OPTIONS = ['4', '6'] as const
const MODE_OPTIONS = [
  { value: 'put', label: 'Short put' },
  { value: 'call', label: 'Covered call' },
] as const
const MOBILE_FLOW_STEPS = [
  {
    value: 'stock',
    title: 'Pick the stock',
    description: 'Start with the ticker. The option chain follows the button you choose.',
  },
  {
    value: 'sizing',
    title: 'Set buying power',
    description: 'Enter cash, pick the broker leverage, and decide how much buying power to deploy.',
  },
  {
    value: 'discovery',
    title: 'Find the range',
    description: 'Pick the expiration and review the live chain values for the 1-sigma move.',
  },
  {
    value: 'results',
    title: 'Review the trade',
    description: 'See the target strike, projected premium, break-even, and payoff shape.',
  },
] as const
const MOBILE_BREAKPOINT = '(max-width: 760px)'

type TradeMode = (typeof MODE_OPTIONS)[number]['value']
type LeverageValue = '' | (typeof LEVERAGE_OPTIONS)[number]
type MobileFlowStep = (typeof MOBILE_FLOW_STEPS)[number]['value']

type FormState = {
  mode: TradeMode
  capital: string
  leverage: LeverageValue
  usage: string
  symbol: (typeof STOCK_OPTIONS)[number]
  expiryEpoch: string
  sharePrice: string
  putAsk: string
  callAsk: string
  putBid: string
  callBid: string
}

type PayoffPoint = {
  price: number
  value: number
}

type MarketCandle = {
  open: number
  close: number
  high: number
  low: number
}

type StrategyPanelProps = {
  accent: TradeMode
  title: string
  subtitle: string
  strike: number
  rawTarget: number
  contracts: number
  effectiveContracts: number
  usingPreviewContract: boolean
  totalPremium: number
  breakEven: number
  maxGain: number
  capitalUsed: number
  capitalLeft: number
  footnote: string
  points: PayoffPoint[]
  spot: number
}

type QuoteStatus = {
  tone: 'idle' | 'loading' | 'success' | 'error'
  text: string
}

type ExpiryDate = {
  label: string
  epoch: number
}

type ChainOption = {
  strike: number
  mid: number
}

type OptionsChainPayload = {
  price?: number
  atmCall?: number
  atmPut?: number
  strike?: number
  iv?: number
  currency?: string
  expiryDates?: ExpiryDate[]
  calls?: ChainOption[]
  puts?: ChainOption[]
  Information?: string
  Note?: string
  error?: string
  message?: string
}

type ActiveChain = {
  currency: string
  calls: ChainOption[]
  puts: ChainOption[]
}

const DEFAULT_FORM: FormState = {
  mode: 'put',
  capital: '',
  leverage: '',
  usage: '',
  symbol: 'NVDA',
  expiryEpoch: '',
  sharePrice: '',
  putAsk: '',
  callAsk: '',
  putBid: '',
  callBid: '',
}

const BACKDROP_CANDLES: MarketCandle[] = Array.from({ length: 34 }, (_, index) => {
  const baseline =
    96 +
    index * 0.92 +
    Math.sin(index / 2.7) * 4.9 -
    Math.max(0, index - 23) * 0.92 +
    Math.max(0, index - 34) * 1.45

  const open = baseline + Math.sin(index * 1.35) * 1.65
  const close = baseline + Math.cos(index * 1.08) * 1.9
  const high = Math.max(open, close) + 1.8 + Math.abs(Math.sin(index * 0.88)) * 2.6
  const low = Math.min(open, close) - 1.55 - Math.abs(Math.cos(index * 1.14)) * 2.35

  return {
    open: Number(open.toFixed(2)),
    close: Number(close.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
  }
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const integerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasValue(value: string) {
  return value.trim() !== ''
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value))
}

function roundDownToIncrement(value: number, increment: number) {
  if (value <= 0 || increment <= 0) {
    return 0
  }

  return Number((Math.floor(value / increment) * increment).toFixed(2))
}

function roundUpToIncrement(value: number, increment: number) {
  if (value <= 0 || increment <= 0) {
    return 0
  }

  return Number((Math.ceil(value / increment) * increment).toFixed(2))
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function formatDecimal(value: number) {
  return decimalFormatter.format(value)
}

function formatInteger(value: number) {
  return integerFormatter.format(value)
}

function formatInputNumber(value: number) {
  return value.toFixed(2)
}

function getOptionMidAtStrike(options: ChainOption[], strike: number) {
  return options.find((option) => Math.abs(option.strike - strike) < 0.001)?.mid
}

function getClosestOptionStrike(
  options: ChainOption[],
  target: number,
  direction: 'below' | 'above',
) {
  const strikes = options
    .map((option) => option.strike)
    .filter((strike) => Number.isFinite(strike))
    .sort((a, b) => a - b)

  if (strikes.length === 0) {
    return undefined
  }

  if (direction === 'below') {
    return [...strikes].reverse().find((strike) => strike <= target) ?? strikes[0]
  }

  return strikes.find((strike) => strike >= target) ?? strikes.at(-1)
}

function pickDefaultExpiry(expiryDates: ExpiryDate[]) {
  const nowInSeconds = Date.now() / 1000
  const futureExpiries = expiryDates.filter(
    (expiryDate) => expiryDate.epoch >= nowInSeconds,
  )

  return (
    futureExpiries.find(
      (expiryDate) => new Date(`${expiryDate.label}T00:00:00Z`).getUTCDay() === 5,
    ) ??
    futureExpiries[0] ??
    expiryDates[0]
  )
}

function hasChainOptions(payload: OptionsChainPayload) {
  return Array.isArray(payload.calls) && Array.isArray(payload.puts)
}

function buildPayoffPoints(
  start: number,
  end: number,
  steps: number,
  payoff: (price: number) => number,
) {
  const safeEnd = end <= start ? start + 1 : end

  return Array.from({ length: steps + 1 }, (_, index) => {
    const price = start + ((safeEnd - start) * index) / steps
    return {
      price,
      value: payoff(price),
    }
  })
}

function getInitialFormState() {
  if (typeof window === 'undefined') {
    return DEFAULT_FORM
  }

  try {
    const savedState = window.localStorage.getItem(STORAGE_KEY)

    if (!savedState) {
      return DEFAULT_FORM
    }

    const parsedState = JSON.parse(savedState) as Partial<FormState>
    return { ...DEFAULT_FORM, ...parsedState }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return DEFAULT_FORM
  }
}

function getInitialIsMobileLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(MOBILE_BREAKPOINT).matches
}

function getOptionsChainEndpoint() {
  if (typeof window === 'undefined') {
    return LOCAL_OPTIONS_CHAIN_ENDPOINT
  }

  const isLocalHost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'

  return isLocalHost ? LOCAL_OPTIONS_CHAIN_ENDPOINT : REMOTE_OPTIONS_CHAIN_ENDPOINT
}

async function fetchOptionsChain(symbol: string, expiryEpoch?: string) {
  const params = new URLSearchParams({
    ticker: symbol,
    source: OPTIONS_CHAIN_SOURCE,
  })

  if (expiryEpoch) {
    params.set('expiry', expiryEpoch)
  }

  const response = await fetch(`${getOptionsChainEndpoint()}?${params.toString()}`)
  const payload = (await response.json()) as OptionsChainPayload
  const apiMessage = payload.Note ?? payload.Information ?? payload.error ?? payload.message

  if (!response.ok || apiMessage) {
    throw new Error(apiMessage ?? 'Options chain is unavailable right now.')
  }

  return payload
}

function BackgroundMarketScene() {
  const svgWidth = 1600
  const svgHeight = 980
  const padding = { top: 70, right: 36, bottom: 110, left: 36 }

  const minPrice = Math.min(...BACKDROP_CANDLES.map((candle) => candle.low))
  const maxPrice = Math.max(...BACKDROP_CANDLES.map((candle) => candle.high))
  const plotWidth = svgWidth - padding.left - padding.right
  const plotHeight = svgHeight - padding.top - padding.bottom
  const candleStep = plotWidth / BACKDROP_CANDLES.length
  const candleBodyWidth = Math.max(10, candleStep * 0.42)

  const yScale = (price: number) =>
    padding.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight

  const gridRows = 7
  const gridCols = 11
  const horizontalGuides = Array.from({ length: gridRows }, (_, index) => {
    const ratio = index / (gridRows - 1)
    return padding.top + ratio * plotHeight
  })
  const verticalGuides = Array.from({ length: gridCols }, (_, index) => {
    const ratio = index / (gridCols - 1)
    return padding.left + ratio * plotWidth
  })

  const tracePath = BACKDROP_CANDLES.map((candle, index) => {
    const x = padding.left + candleStep * index + candleStep / 2
    const y = yScale(candle.close)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')

  return (
    <div className="market-backdrop" aria-hidden="true">
      <div className="market-glow market-glow-hot" />
      <div className="market-glow market-glow-positive" />

      <svg
        className="market-backdrop-svg"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {horizontalGuides.map((y, index) => (
          <line
            key={`row-${index}`}
            className="market-grid-line"
            x1={0}
            x2={svgWidth}
            y1={y}
            y2={y}
          />
        ))}

        {verticalGuides.map((x, index) => (
          <line
            key={`col-${index}`}
            className="market-grid-line"
            x1={x}
            x2={x}
            y1={0}
            y2={svgHeight}
          />
        ))}

        <path className="market-trace" d={tracePath} />

        {BACKDROP_CANDLES.map((candle, index) => {
          const x = padding.left + candleStep * index + candleStep / 2
          const wickTop = yScale(candle.high)
          const wickBottom = yScale(candle.low)
          const bodyTop = yScale(Math.max(candle.open, candle.close))
          const bodyBottom = yScale(Math.min(candle.open, candle.close))
          const isUp = candle.close >= candle.open

          return (
            <g
              key={index}
              className={`market-candle-group ${isUp ? 'market-candle-up' : 'market-candle-down'}`}
              style={{
                animationDelay: `${index * 120}ms`,
                animationDuration: `${5.6 + (index % 6) * 0.35}s`,
              }}
            >
              <line
                className="market-candle-wick"
                x1={x}
                x2={x}
                y1={wickTop}
                y2={wickBottom}
              />
              <rect
                className="market-candle-body"
                x={x - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={Math.max(bodyBottom - bodyTop, 7)}
                rx={5}
                ry={5}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StrategyPanel({
  accent,
  title,
  subtitle,
  strike,
  rawTarget,
  contracts,
  effectiveContracts,
  usingPreviewContract,
  totalPremium,
  breakEven,
  maxGain,
  capitalUsed,
  capitalLeft,
  footnote,
  points,
  spot,
}: StrategyPanelProps) {
  const svgWidth = 500
  const svgHeight = 238
  const padding = { top: 18, right: 18, bottom: 34, left: 18 }

  const minPrice = points[0]?.price ?? 0
  const maxPrice = points.at(-1)?.price ?? 1
  const values = points.map((point) => point.value)
  const baseMinValue = Math.min(...values, 0)
  const baseMaxValue = Math.max(...values, 0)
  const yPadding = Math.max((baseMaxValue - baseMinValue) * 0.1, 120)
  const minValue = baseMinValue - yPadding
  const maxValue = baseMaxValue + yPadding

  const xScale = (price: number) => {
    if (maxPrice === minPrice) {
      return padding.left
    }

    return (
      padding.left +
      ((price - minPrice) / (maxPrice - minPrice)) *
        (svgWidth - padding.left - padding.right)
    )
  }

  const yScale = (value: number) =>
    padding.top +
    ((maxValue - value) / (maxValue - minValue)) *
      (svgHeight - padding.top - padding.bottom)

  const linePath = points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command} ${xScale(point.price).toFixed(2)} ${yScale(point.value).toFixed(2)}`
    })
    .join(' ')

  const baselineY = Math.max(
    padding.top,
    Math.min(yScale(0), svgHeight - padding.bottom),
  )

  const areaPath = [
    linePath,
    `L ${xScale(maxPrice).toFixed(2)} ${baselineY.toFixed(2)}`,
    `L ${xScale(minPrice).toFixed(2)} ${baselineY.toFixed(2)}`,
    'Z',
  ].join(' ')

  const tone = accent === 'put' ? '#f35a73' : '#25d98b'
  const referenceLines = [
    {
      key: 'spot',
      label: 'Spot',
      x: xScale(spot),
      color: 'rgba(240, 241, 245, 0.34)',
    },
    {
      key: 'strike',
      label: 'Strike',
      x: xScale(strike),
      color:
        accent === 'put'
          ? 'rgba(243, 90, 115, 0.8)'
          : 'rgba(37, 217, 139, 0.8)',
    },
  ]

  return (
    <article className={`strategy-panel strategy-panel-${accent}`}>
      <div className="strategy-topline">
        <div>
          <p className="kicker">{subtitle}</p>
          <h2>{title}</h2>
        </div>
        <p className="strategy-contract-label">
          {usingPreviewContract
            ? '1-contract preview'
            : `${formatInteger(contracts)} contracts`}
        </p>
      </div>

      <div className="strategy-strike-row">
        <div>
          <span>Target strike</span>
          <strong>{formatCurrency(strike)}</strong>
        </div>
        <div>
          <span>Raw 1-sigma target</span>
          <strong>{formatCurrency(rawTarget)}</strong>
        </div>
      </div>

      <div className="strategy-metrics">
        <div>
          <span>Contracts</span>
          <strong>{formatInteger(contracts)}</strong>
        </div>
        <div>
          <span>Premium received</span>
          <strong>{formatCurrency(totalPremium)}</strong>
        </div>
        <div>
          <span>Break-even</span>
          <strong>{formatCurrency(breakEven)}</strong>
        </div>
        <div>
          <span>Max gain</span>
          <strong>{formatCurrency(maxGain)}</strong>
        </div>
        <div>
          <span>Capital used</span>
          <strong>{formatCurrency(capitalUsed)}</strong>
        </div>
        <div>
          <span>Capital left</span>
          <strong>{formatCurrency(capitalLeft)}</strong>
        </div>
      </div>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label={`${title} payoff chart`}
        >
          <defs>
            <linearGradient
              id={`gradient-${accent}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={tone} stopOpacity="0.34" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>

          <line
            x1={padding.left}
            x2={svgWidth - padding.right}
            y1={baselineY}
            y2={baselineY}
            className="chart-zero-line"
          />

          {referenceLines.map((line) => (
            <g key={line.key}>
              <line
                x1={line.x}
                x2={line.x}
                y1={padding.top}
                y2={svgHeight - padding.bottom}
                stroke={line.color}
                strokeDasharray="5 6"
                strokeWidth="1.25"
              />
              <text
                x={line.x}
                y={svgHeight - 10}
                className="chart-label"
                textAnchor="middle"
              >
                {line.label}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#gradient-${accent})`} />
          <path
            d={linePath}
            fill="none"
            stroke={tone}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="chart-footer">
        <span>{formatCurrency(minPrice)}</span>
        <span>Expiry stock price</span>
        <span>{formatCurrency(maxPrice)}</span>
      </div>

      <p className="strategy-footnote">
        {footnote}{' '}
        {usingPreviewContract
          ? `P/L preview uses ${formatInteger(effectiveContracts)} contract.`
          : ''}
      </p>
    </article>
  )
}

function App() {
  const [form, setForm] = useState<FormState>(getInitialFormState)
  const [isMobileLayout, setIsMobileLayout] = useState(getInitialIsMobileLayout)
  const [mobileStep, setMobileStep] = useState<MobileFlowStep>('stock')
  const [chainStatus, setChainStatus] = useState<QuoteStatus>({
    tone: 'idle',
    text: 'Options chain is ready.',
  })
  const [isChainLoading, setIsChainLoading] = useState(false)
  const [expiryDates, setExpiryDates] = useState<ExpiryDate[]>([])
  const [activeChain, setActiveChain] = useState<ActiveChain | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileLayout(event.matches)
    }

    setIsMobileLayout(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !isMobileLayout) {
      return
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }, [isMobileLayout, mobileStep])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  }, [form])

  const capital = Math.max(0, parseNumber(form.capital))
  const leverage = parseNumber(form.leverage)
  const usage = clampPercentage(parseNumber(form.usage))
  const usageSliderValue = form.usage === '' ? '0' : String(usage)
  const sharePrice = Math.max(0, parseNumber(form.sharePrice))
  const putAsk = Math.max(0, parseNumber(form.putAsk))
  const callAsk = Math.max(0, parseNumber(form.callAsk))
  const putBid = Math.max(0, parseNumber(form.putBid))
  const callBid = Math.max(0, parseNumber(form.callBid))
  const strikeIncrement = 1

  const symbol = form.symbol

  const totalBuyingPower = capital * leverage
  const deployedBuyingPower = totalBuyingPower * (usage / 100)
  const oneSigmaValue = putAsk + callAsk
  const rawPutTarget = Math.max(0, sharePrice - oneSigmaValue)
  const rawCallTarget = sharePrice + oneSigmaValue
  const chainPutStrike = activeChain
    ? getClosestOptionStrike(activeChain.puts, rawPutTarget, 'below')
    : undefined
  const chainCallStrike = activeChain
    ? getClosestOptionStrike(activeChain.calls, rawCallTarget, 'above')
    : undefined
  const putStrike = chainPutStrike ?? roundDownToIncrement(rawPutTarget, strikeIncrement)
  const callStrike = chainCallStrike ?? roundUpToIncrement(rawCallTarget, strikeIncrement)

  const putContractBasis = putStrike * 100
  const coveredCallContractBasis = sharePrice * 100
  const putContracts =
    putContractBasis > 0
      ? Math.floor(deployedBuyingPower / putContractBasis)
      : 0
  const coveredCallContracts =
    coveredCallContractBasis > 0
      ? Math.floor(deployedBuyingPower / coveredCallContractBasis)
      : 0

  const putCapitalUsed = putContracts * putContractBasis
  const coveredCallCapitalUsed = coveredCallContracts * coveredCallContractBasis
  const putCapitalLeft = Math.max(0, deployedBuyingPower - putCapitalUsed)
  const coveredCallCapitalLeft = Math.max(
    0,
    deployedBuyingPower - coveredCallCapitalUsed,
  )

  const putEffectiveContracts = Math.max(putContracts, 1)
  const callEffectiveContracts = Math.max(coveredCallContracts, 1)
  const putTotalPremium = putBid * 100 * putEffectiveContracts
  const callTotalPremium = callBid * 100 * callEffectiveContracts
  const putBreakEven = Math.max(0, putStrike - putBid)
  const coveredCallBreakEven = Math.max(0, sharePrice - callBid)
  const putMaxGain = putTotalPremium
  const coveredCallMaxGain =
    (callStrike - sharePrice + callBid) * 100 * callEffectiveContracts

  const chartWindow = Math.max(oneSigmaValue * 3, sharePrice * 0.18, 10)
  const chartStart = Math.max(0, sharePrice - chartWindow)
  const chartEnd = Math.max(chartStart + 1, sharePrice + chartWindow)

  const putPayoffPoints = buildPayoffPoints(
    chartStart,
    chartEnd,
    40,
    (price) => {
      const perShareProfit = putBid - Math.max(0, putStrike - price)
      return perShareProfit * 100 * putEffectiveContracts
    },
  )

  const coveredCallPayoffPoints = buildPayoffPoints(
    chartStart,
    chartEnd,
    40,
    (price) => {
      const stockAndCallProfit =
        Math.min(price, callStrike) - sharePrice + callBid
      return stockAndCallProfit * 100 * callEffectiveContracts
    },
  )

  const isPutMode = form.mode === 'put'
  const hasSelectedChainScope = hasValue(form.expiryEpoch) || activeChain !== null
  const canRefreshChain = hasSelectedChainScope
  const activeStrike = isPutMode ? putStrike : callStrike
  const activePremiumInput = isPutMode ? form.putBid : form.callBid
  const selectedExpiryLabel =
    expiryDates.find((expiryDate) => String(expiryDate.epoch) === form.expiryEpoch)
      ?.label ?? (form.expiryEpoch ? 'Selected expiry' : 'No expiry selected')
  const putChainPremium =
    activeChain && putStrike > 0
      ? getOptionMidAtStrike(activeChain.puts, putStrike)
      : undefined
  const callChainPremium =
    activeChain && callStrike > 0
      ? getOptionMidAtStrike(activeChain.calls, callStrike)
      : undefined
  const mobileStepIndex = MOBILE_FLOW_STEPS.findIndex(
    (step) => step.value === mobileStep,
  )
  const currentMobileStep = MOBILE_FLOW_STEPS[mobileStepIndex]
  const isMobileResultsStep = isMobileLayout && mobileStep === 'results'
  const showStockSection = !isMobileLayout || mobileStep === 'stock'
  const showSizingSection = !isMobileLayout || mobileStep === 'sizing'
  const showDiscoverySection = !isMobileLayout || mobileStep === 'discovery'
  const showPremiumSection = !isMobileLayout || mobileStep === 'discovery'
  const showResultsPanel = !isMobileLayout || mobileStep === 'results'
  const isSizingStepComplete =
    hasValue(form.capital) && hasValue(form.leverage) && hasValue(form.usage)
  const isDiscoveryStepComplete =
    hasSelectedChainScope &&
    hasValue(form.sharePrice) &&
    hasValue(form.putAsk) &&
    hasValue(form.callAsk) &&
    hasValue(activePremiumInput)
  const isCurrentMobileStepComplete =
    mobileStep === 'stock'
      ? true
      : mobileStep === 'sizing'
        ? isSizingStepComplete
        : mobileStep === 'discovery'
          ? isDiscoveryStepComplete
          : true
  const mobileStepRequirementMessage =
    mobileStep === 'sizing'
      ? 'Enter cash capital, broker leverage, and buy power deployed before continuing.'
      : mobileStep === 'discovery'
        ? 'Pick an expiry, load the chain values, and confirm the selling premium before showing stats.'
        : ''
  const activeSummaryMetrics = [
    { label: 'Spot', value: formatCurrency(sharePrice) },
    { label: '1-sigma', value: formatCurrency(oneSigmaValue) },
    { label: 'Deployed BP', value: formatCurrency(deployedBuyingPower) },
    { label: 'Target strike', value: formatCurrency(activeStrike) },
  ]

  const activeStrategy = isPutMode
    ? {
        accent: 'put' as const,
        title: 'Short put',
        subtitle: 'Sell put premium',
        strike: putStrike,
        rawTarget: rawPutTarget,
        contracts: putContracts,
        effectiveContracts: putEffectiveContracts,
        usingPreviewContract: putContracts === 0,
        totalPremium: putTotalPremium,
        breakEven: putBreakEven,
        maxGain: putMaxGain,
        capitalUsed: putCapitalUsed,
        capitalLeft: putCapitalLeft,
        footnote: 'Sizing uses rounded put strike x 100 shares.',
        points: putPayoffPoints,
      }
    : {
        accent: 'call' as const,
        title: 'Covered call',
        subtitle: 'Sell covered call premium',
        strike: callStrike,
        rawTarget: rawCallTarget,
        contracts: coveredCallContracts,
        effectiveContracts: callEffectiveContracts,
        usingPreviewContract: coveredCallContracts === 0,
        totalPremium: callTotalPremium,
        breakEven: coveredCallBreakEven,
        maxGain: coveredCallMaxGain,
        capitalUsed: coveredCallCapitalUsed,
        capitalLeft: coveredCallCapitalLeft,
        footnote: 'Sizing assumes shares are owned from current spot.',
        points: coveredCallPayoffPoints,
      }

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateFields(fields: Partial<FormState>) {
    setForm((current) => ({
      ...current,
      ...fields,
    }))
  }

  function handleNumericInput<K extends keyof Pick<
    FormState,
    | 'capital'
    | 'usage'
    | 'sharePrice'
    | 'putAsk'
    | 'callAsk'
    | 'putBid'
    | 'callBid'
  >>(field: K, value: string) {
    if (value === '' || /^(\d+)?(\.\d{0,2})?$/.test(value)) {
      updateField(field, value as FormState[K])
    }
  }

  function resetForm() {
    setForm(DEFAULT_FORM)
    setMobileStep('stock')
  }

  function goToMobileStep(nextStep: MobileFlowStep) {
    setMobileStep(nextStep)
  }

  function goToNextMobileStep() {
    const nextIndex = Math.min(
      MOBILE_FLOW_STEPS.length - 1,
      mobileStepIndex + 1,
    )
    setMobileStep(MOBILE_FLOW_STEPS[nextIndex].value)
  }

  function goToPreviousMobileStep() {
    const previousIndex = Math.max(0, mobileStepIndex - 1)
    setMobileStep(MOBILE_FLOW_STEPS[previousIndex].value)
  }

  async function refreshSelectedOptionsChain() {
    if (!hasSelectedChainScope) {
      setChainStatus({
        tone: 'error',
        text: 'Pick an expiry before refreshing the chain.',
      })
      return
    }

    setIsChainLoading(true)
    setChainStatus({
      tone: 'loading',
      text: `Loading ${symbol} ${selectedExpiryLabel} chain...`,
    })

    try {
      const payload = await fetchOptionsChain(symbol, form.expiryEpoch || undefined)

      if (!hasChainOptions(payload)) {
        throw new Error('Options chain returned without calls and puts.')
      }

      setActiveChain({
        currency: payload.currency ?? 'USD',
        calls: payload.calls ?? [],
        puts: payload.puts ?? [],
      })

      updateFields({
        sharePrice:
          typeof payload.price === 'number'
            ? formatInputNumber(payload.price)
            : form.sharePrice,
        putAsk:
          typeof payload.atmPut === 'number'
            ? formatInputNumber(payload.atmPut)
            : form.putAsk,
        callAsk:
          typeof payload.atmCall === 'number'
            ? formatInputNumber(payload.atmCall)
            : form.callAsk,
      })

      setChainStatus({
        tone: 'success',
        text: `${symbol} ${selectedExpiryLabel} chain loaded.`,
      })
    } catch (error) {
      setChainStatus({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Options chain failed to load.',
      })
    } finally {
      setIsChainLoading(false)
    }
  }

  useEffect(() => {
    let ignore = false

    async function loadExpiryChoices() {
      setIsChainLoading(true)
      setChainStatus({
        tone: 'loading',
        text: `Loading ${symbol} expiries...`,
      })

      try {
        const payload = await fetchOptionsChain(symbol)

        if (ignore) {
          return
        }

        if (hasChainOptions(payload)) {
          setExpiryDates([])
          setActiveChain({
            currency: payload.currency ?? 'USD',
            calls: payload.calls ?? [],
            puts: payload.puts ?? [],
          })
          setForm((current) => ({
            ...current,
            expiryEpoch: '',
            sharePrice:
              typeof payload.price === 'number'
                ? formatInputNumber(payload.price)
                : current.sharePrice,
            putAsk:
              typeof payload.atmPut === 'number'
                ? formatInputNumber(payload.atmPut)
                : current.putAsk,
            callAsk:
              typeof payload.atmCall === 'number'
                ? formatInputNumber(payload.atmCall)
                : current.callAsk,
          }))
          setChainStatus({
            tone: 'success',
            text: `${symbol} chain loaded.`,
          })
          return
        }

        const nextExpiryDates = payload.expiryDates ?? []
        const defaultExpiry = pickDefaultExpiry(nextExpiryDates)

        setExpiryDates(nextExpiryDates)
        setActiveChain(null)
        setForm((current) => ({
          ...current,
          expiryEpoch: defaultExpiry ? String(defaultExpiry.epoch) : '',
          sharePrice:
            typeof payload.price === 'number'
              ? formatInputNumber(payload.price)
              : current.sharePrice,
        }))

        setChainStatus({
          tone: defaultExpiry ? 'success' : 'error',
          text: defaultExpiry
            ? `${symbol} expiries loaded.`
            : `${symbol} expiries are unavailable.`,
        })
      } catch (error) {
        if (ignore) {
          return
        }

        setExpiryDates([])
        setActiveChain(null)
        setChainStatus({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Options expiries failed to load.',
        })
      } finally {
        if (!ignore) {
          setIsChainLoading(false)
        }
      }
    }

    void loadExpiryChoices()

    return () => {
      ignore = true
    }
  }, [symbol])

  useEffect(() => {
    if (!form.expiryEpoch) {
      return undefined
    }

    let ignore = false

    async function loadSelectedChain() {
      setIsChainLoading(true)
      setChainStatus({
        tone: 'loading',
        text: `Loading ${symbol} ${selectedExpiryLabel} chain...`,
      })

      try {
        const payload = await fetchOptionsChain(symbol, form.expiryEpoch)

        if (ignore) {
          return
        }

        if (!hasChainOptions(payload)) {
          throw new Error('Options chain returned without calls and puts.')
        }

        setActiveChain({
          currency: payload.currency ?? 'USD',
          calls: payload.calls ?? [],
          puts: payload.puts ?? [],
        })
        setForm((current) => ({
          ...current,
          sharePrice:
            typeof payload.price === 'number'
              ? formatInputNumber(payload.price)
              : current.sharePrice,
          putAsk:
            typeof payload.atmPut === 'number'
              ? formatInputNumber(payload.atmPut)
              : current.putAsk,
          callAsk:
            typeof payload.atmCall === 'number'
              ? formatInputNumber(payload.atmCall)
              : current.callAsk,
        }))
        setChainStatus({
          tone: 'success',
          text: `${symbol} ${selectedExpiryLabel} chain loaded.`,
        })
      } catch (error) {
        if (ignore) {
          return
        }

        setActiveChain(null)
        setChainStatus({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Options chain failed to load.',
        })
      } finally {
        if (!ignore) {
          setIsChainLoading(false)
        }
      }
    }

    void loadSelectedChain()

    return () => {
      ignore = true
    }
  }, [form.expiryEpoch, selectedExpiryLabel, symbol])

  useEffect(() => {
    if (!activeChain) {
      return
    }

    const nextPutPremium =
      putStrike > 0 ? getOptionMidAtStrike(activeChain.puts, putStrike) : undefined
    const nextCallPremium =
      callStrike > 0 ? getOptionMidAtStrike(activeChain.calls, callStrike) : undefined

    setForm((current) => ({
      ...current,
      putBid:
        typeof nextPutPremium === 'number'
          ? formatInputNumber(nextPutPremium)
          : current.putBid,
      callBid:
        typeof nextCallPremium === 'number'
          ? formatInputNumber(nextCallPremium)
          : current.callBid,
    }))
  }, [activeChain, callStrike, putStrike])

  return (
    <>
      <BackgroundMarketScene />

      <main className="app-shell">
        <section className="workspace-frame">
          <aside
            className={`controls-panel ${isMobileResultsStep ? 'controls-panel-mobile-results' : ''}`}
          >
            <header className="controls-head">
              <div>
                <p className="brand">Sigma Sell</p>
                <h1>One Friday side at a time.</h1>
              </div>
              <button className="ghost-button" type="button" onClick={resetForm}>
                Clear form
              </button>
            </header>

            <div className="mode-switch" aria-label="Trade side">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === form.mode ? 'is-active' : ''}
                  onClick={() => updateField('mode', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {isMobileLayout ? (
              <section className="mobile-step-overview">
                <div className="mobile-step-copy">
                  <p className="section-kicker">
                    Step {mobileStepIndex + 1} of {MOBILE_FLOW_STEPS.length}
                  </p>
                  <h2>{currentMobileStep.title}</h2>
                  <p className="section-note">{currentMobileStep.description}</p>
                </div>

                <div className="mobile-step-dots" aria-hidden="true">
                  {MOBILE_FLOW_STEPS.map((step, index) => (
                    <span
                      key={step.value}
                      className={[
                        'mobile-step-dot',
                        step.value === mobileStep ? 'is-active' : '',
                        index < mobileStepIndex ? 'is-complete' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <p className="controls-note">
                Show one ticket only. <strong>Chain mids</strong> find the
                1-sigma range. <strong> Premium at selling price</strong> stays
                editable for your broker fill.
              </p>
            )}

            {showStockSection && (
              <section className="control-section">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">Step 1</p>
                    <h2>Pick stock</h2>
                  </div>
                </div>

                <div className="chip-row">
                  {STOCK_OPTIONS.map((ticker) => (
                    <button
                      key={ticker}
                      type="button"
                      className={ticker === form.symbol ? 'chip-active' : ''}
                      onClick={() => {
                        setActiveChain(null)
                        setExpiryDates([])
                        updateFields({
                          symbol: ticker,
                          expiryEpoch: '',
                          sharePrice: '',
                          putAsk: '',
                          callAsk: '',
                          putBid: '',
                          callBid: '',
                        })

                        if (isMobileLayout && mobileStep === 'stock') {
                          goToMobileStep('sizing')
                        }
                      }}
                    >
                      {ticker}
                    </button>
                  ))}
                </div>

                <p className="field-note">
                  The options chain stays tied to the stock button you choose.
                </p>
              </section>
            )}

            {showSizingSection && (
              <section className="control-section">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">Step 2</p>
                    <h2>Capital and leverage</h2>
                  </div>
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>Cash capital ($)</span>
                    <input
                      inputMode="decimal"
                      type="text"
                      value={form.capital}
                      onChange={(event) =>
                        handleNumericInput('capital', event.target.value)
                      }
                      placeholder="25000"
                    />
                  </label>

                  <div className="field">
                    <span>Broker leverage</span>
                    <div className="segmented-control">
                      {LEVERAGE_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={option === form.leverage ? 'is-active' : ''}
                          onClick={() => updateField('leverage', option)}
                        >
                          {option}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="field field-full">
                    <div className="field-row">
                      <span>Buy power deployed</span>
                      <strong>
                        {form.usage === '' ? '—' : `${formatDecimal(usage)}%`}
                      </strong>
                    </div>
                    <input
                      className="range-input"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={usageSliderValue}
                      onChange={(event) =>
                        updateField('usage', event.target.value)
                      }
                    />
                    <input
                      className="range-value"
                      inputMode="decimal"
                      type="text"
                      value={form.usage}
                      onChange={(event) =>
                        handleNumericInput('usage', event.target.value)
                      }
                      aria-label="Buy power percentage"
                    />
                  </div>
                </div>
              </section>
            )}

            {showDiscoverySection && (
              <section className="control-section">
              <div className="section-head">
                <div>
                  <p className="section-kicker">Step 3</p>
                  <h2>Discovery range</h2>
                </div>
                <span className="section-tag">Chain data</span>
              </div>

              <div className="section-meta">
                <button
                  className="quote-button"
                  type="button"
                  onClick={() => {
                    void refreshSelectedOptionsChain()
                  }}
                  disabled={isChainLoading || !canRefreshChain}
                >
                  {isChainLoading ? 'Loading chain...' : 'Refresh chain'}
                </button>
                <span className={`quote-status quote-status-${chainStatus.tone}`}>
                  {chainStatus.text}
                </span>
              </div>

              <div className="field-grid">
                <label className="field field-full">
                  <span>Expiration date</span>
                  <select
                    value={form.expiryEpoch}
                    onChange={(event) =>
                      updateField('expiryEpoch', event.target.value)
                    }
                    disabled={isChainLoading || expiryDates.length === 0}
                  >
                    {expiryDates.length === 0 ? (
                      <option value="">Latest chain</option>
                    ) : (
                      expiryDates.map((expiryDate) => (
                        <option
                          key={expiryDate.epoch}
                          value={String(expiryDate.epoch)}
                        >
                          {expiryDate.label}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="field">
                  <span>Spot price ($)</span>
                  <input
                    inputMode="decimal"
                    type="text"
                    value={form.sharePrice}
                    onChange={(event) =>
                      handleNumericInput('sharePrice', event.target.value)
                    }
                    placeholder="112.40"
                  />
                </label>

                <label className="field">
                  <span>ATM put mid ($)</span>
                  <input
                    inputMode="decimal"
                    type="text"
                    value={form.putAsk}
                    onChange={(event) =>
                      handleNumericInput('putAsk', event.target.value)
                    }
                    placeholder="2.18"
                  />
                </label>

                <label className="field">
                  <span>ATM call mid ($)</span>
                  <input
                    inputMode="decimal"
                    type="text"
                    value={form.callAsk}
                    onChange={(event) =>
                      handleNumericInput('callAsk', event.target.value)
                    }
                    placeholder="2.44"
                  />
                </label>
              </div>

              <p className="field-note">
                Spot, ATM mids, target strikes, and target premium estimates are
                filled from the selected options chain.
              </p>

              <div className="discovery-readout">
                <div>
                  <span>1-sigma move</span>
                  <strong>{formatCurrency(oneSigmaValue)}</strong>
                </div>
                <div>
                  <span>Put / Call targets</span>
                  <strong>
                    {formatCurrency(putStrike)} / {formatCurrency(callStrike)}
                  </strong>
                </div>
              </div>
            </section>
            )}

            {showPremiumSection && (
              <section className="control-section control-section-compact">
              <div className="section-head">
                <div>
                  <p className="section-kicker">Premium</p>
                  <h2>Premium at selling price</h2>
                </div>
                <span className="section-tag section-tag-live">MID</span>
              </div>

              <label className="field">
                <span>Premium at selling price ($)</span>
                <input
                  inputMode="decimal"
                  type="text"
                  value={activePremiumInput}
                  onChange={(event) =>
                    handleNumericInput(isPutMode ? 'putBid' : 'callBid', event.target.value)
                  }
                  placeholder={isPutMode ? '1.12' : '1.34'}
                />
              </label>

              <p className="section-note">
                {isPutMode
                  ? `Auto-filled from the ${formatCurrency(putStrike)} put mid${
                      typeof putChainPremium === 'number'
                        ? ` (${formatCurrency(putChainPremium)})`
                        : ''
                    }.`
                  : `Auto-filled from the ${formatCurrency(callStrike)} call mid${
                      typeof callChainPremium === 'number'
                        ? ` (${formatCurrency(callChainPremium)})`
                        : ''
                    }.`}
              </p>
            </section>
            )}

            {isMobileResultsStep && (
              <section className="control-section mobile-review-card">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">Step 4</p>
                    <h2>Projected stats</h2>
                  </div>
                </div>

                <p className="section-note">
                  The trade ticket is live below. Go back one step if you want to
                  adjust the range or premium.
                </p>
              </section>
            )}

            {isMobileLayout && (
              <div className="mobile-flow-nav">
                {mobileStepIndex > 0 ? (
                  <button
                    type="button"
                    className="mobile-flow-button mobile-flow-button-secondary"
                    onClick={goToPreviousMobileStep}
                  >
                    Back
                  </button>
                ) : (
                  <div className="mobile-flow-spacer" />
                )}

                <button
                  type="button"
                  className="mobile-flow-button mobile-flow-button-primary"
                  disabled={mobileStep !== 'results' && !isCurrentMobileStepComplete}
                  onClick={
                    mobileStep === 'results'
                      ? () => goToMobileStep('discovery')
                      : goToNextMobileStep
                  }
                >
                  {mobileStep === 'stock' && 'Next: sizing'}
                  {mobileStep === 'sizing' && 'Next: range'}
                  {mobileStep === 'discovery' && 'Show stats'}
                  {mobileStep === 'results' && 'Edit inputs'}
                </button>
              </div>
            )}

            {isMobileLayout &&
              mobileStep !== 'results' &&
              !isCurrentMobileStepComplete && (
                <p className="mobile-flow-note">{mobileStepRequirementMessage}</p>
              )}
          </aside>

          {showResultsPanel && (
          <section
            className={`result-panel result-panel-${activeStrategy.accent} ${
              isMobileResultsStep ? 'result-panel-mobile-results' : ''
            }`}
          >
            <header className="result-head">
              <div>
                <p className="brand brand-light">{symbol}</p>
                <h2>
                  {isPutMode ? 'Short put ticket' : 'Covered call ticket'}
                </h2>
              </div>
              <p className="result-note">
                {isPutMode ? 'Downside income view' : 'Upside cap view'}
              </p>
            </header>

            <div className="summary-strip">
              {activeSummaryMetrics.map((metric) => (
                <article key={metric.label} className="summary-metric">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>

            <StrategyPanel
              accent={activeStrategy.accent}
              title={activeStrategy.title}
              subtitle={activeStrategy.subtitle}
              strike={activeStrategy.strike}
              rawTarget={activeStrategy.rawTarget}
              contracts={activeStrategy.contracts}
              effectiveContracts={activeStrategy.effectiveContracts}
              usingPreviewContract={activeStrategy.usingPreviewContract}
              totalPremium={activeStrategy.totalPremium}
              breakEven={activeStrategy.breakEven}
              maxGain={activeStrategy.maxGain}
              capitalUsed={activeStrategy.capitalUsed}
              capitalLeft={activeStrategy.capitalLeft}
              footnote={activeStrategy.footnote}
              points={activeStrategy.points}
              spot={sharePrice}
            />
          </section>
          )}
        </section>
      </main>
    </>
  )
}

export default App
