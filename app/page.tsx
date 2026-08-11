"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""
const A = (p: string) => `${basePath}/${p}`

const EMAIL = "yoga.byloupopulin@gmail.com"
const ig = (t: string) => `https://ig.me/m/bylou.yoga?text=${encodeURIComponent(t)}`
const mail = (s: string, b: string) => `mailto:${EMAIL}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`
const EASE = "cubic-bezier(.22,.61,.36,1)"

// El diseño exportado de Claude Design usa strings CSS inline; se parsean a
// objetos de estilo de React en vez de reescribir ~500 declaraciones a mano.
const styleCache = new Map<string, React.CSSProperties>()
function s(css: string): React.CSSProperties {
  const hit = styleCache.get(css)
  if (hit) return hit
  const out: Record<string, string> = {}
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":")
    if (i === -1) continue
    const prop = decl.slice(0, i).trim()
    if (!prop) continue
    out[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decl.slice(i + 1).trim()
  }
  const obj = out as React.CSSProperties
  styleCache.set(css, obj)
  return obj
}

type HovProps = {
  tag?: any
  css: string
  hover?: string
  children?: React.ReactNode
  [key: string]: any
}

function Hov({ tag: Tag = "div", css, hover, style, children, ...rest }: HovProps) {
  const [on, setOn] = useState(false)
  return (
    <Tag
      {...rest}
      style={{ ...s(css), ...style, ...(on && hover ? s(hover) : {}) }}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
    >
      {children}
    </Tag>
  )
}

const ArrowIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "relative" }}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
)

const IgIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
)

const MailIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)

const CheckIcon = ({ stroke = "#A41D2D", size = 12, style }: { stroke?: string; size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

const INTENTS = [
  {
    key: "estres",
    chip: "Estrés y ansiedad",
    title: "Bajar el ruido mental sin tener que meditar una hora",
    intro: "Si llegás a la noche acelerado y te cuesta dormir, empezamos por la respiración y el sistema nervioso antes que por las posturas.",
    points: [{ t: "Prácticas de 20–45 min que podés sostener en una semana real" }, { t: "Respiración guiada para cortar el pico de ansiedad en el momento" }, { t: "Entendés qué pasa en tu cerebro, así lo repetís sin mí" }],
    format: "1:1 personalizado",
    formatNote: "Online o presencial. Coordinamos horario según tu semana.",
    quote: "Me han ayudado muchísimo, tanto para mejorar mi postura como para aliviar la ansiedad.",
    quoteBy: "Roxana S., Direc. Creativa",
    cta: "Escribime por Instagram",
    msg: "Hola Lou! Vengo de la web. Me interesa trabajar estrés y ansiedad 🌸 ¿Cómo empezamos?",
  },
  {
    key: "cuerpo",
    chip: "Dolor y tensión física",
    title: "Soltar cervicales, lumbares y todo lo que junta el escritorio",
    intro: "Trabajamos con anatomía y biomecánica: adaptamos cada postura a tu cuerpo, sin exigencia estética ni dolor.",
    points: [{ t: "Diagnóstico postural en la primera sesión" }, { t: "Rutina corta para hacer entre clases, en casa o en la oficina" }, { t: "Adaptaciones con bloques, manta y bolster si los necesitás" }],
    format: "1:1 personalizado",
    formatNote: "Ideal si nunca practicaste o si tenés una molestia puntual.",
    quote: "Las clases son súper personalizadas, adaptadas tanto a mis objetivos como a mi flexibilidad.",
    quoteBy: "Santiago G., Prof. de Ed. Física",
    cta: "Escribime por Instagram",
    msg: "Hola Lou! Vengo de la web. Tengo tensión/dolor y quiero probar una clase 1:1 🌸",
  },
  {
    key: "deporte",
    chip: "Rendimiento deportivo",
    title: "Movilidad, recuperación y foco para entrenar mejor",
    intro: "Yoga como complemento del entrenamiento: esfuerzo físico real, más movilidad y una cabeza que sostiene la competencia.",
    points: [{ t: "Trabajo de movilidad y elongación según tu deporte" }, { t: "Respiración para recuperación y control del pulso" }, { t: "Atención y presencia aplicadas al rendimiento" }],
    format: "1:1 o dúo",
    formatNote: "Se combina bien con tu plan de entrenamiento actual.",
    quote: "No encontraba algo dinámico y con esfuerzo físico real como en las clases de Luchi.",
    quoteBy: "Lucas B., Ingeniero",
    cta: "Escribime por Instagram",
    msg: "Hola Lou! Vengo de la web. Entreno y quiero sumar yoga para movilidad y foco 🌸",
  },
  {
    key: "empresa",
    chip: "Mi equipo / empresa",
    title: "Pausas activas que se notan en la reunión siguiente",
    intro: "Sesiones de 10 a 45 minutos para equipos: menos dolor de oficina, más foco y un beneficio de bienestar que la gente sí usa.",
    points: [{ t: "Formato remoto o en oficina, con o sin mat" }, { t: "Menos dolor cervical y lumbar en el equipo" }, { t: "Respiración y foco antes de reuniones clave" }],
    format: "Programa para empresas",
    formatNote: "Propuesta a medida por cantidad de personas y frecuencia.",
    quote: "Uno se siente libre, en un espacio de reflexión y paz. Toda la info que transmitió fue super útil.",
    quoteBy: "Ana D., Estudiante de Psicología",
    cta: "Pedir propuesta por Instagram",
    msg: "Hola Lou! Vengo de la web. Quiero una propuesta de pausas activas para mi equipo 🌸",
  },
]

const STORIES = [
  { avatar: "assets/avatar-delia.jpg", tagLabel: "Ansiedad", lead: "Practicar yoga con vos es un verdadero regalo del universo", rest: "Se nota tu preparación, tu amor por lo que hacés y la paz que irradiás. Gracias por recordarme la importancia de respirar, soltar y conectar.", author: "Delia C.", profession: "Docente" },
  { avatar: "assets/avatar-roxana.jpg", tagLabel: "Postura", lead: "Me ayudó muchísimo a mejorar mi postura y aliviar la ansiedad", rest: "Siempre atenta y amable, se nota que pone el corazón en cada clase. Disfruto poder incluirlas como parte de mi proceso personal.", author: "Roxana S.", profession: "Direc. Creativa Publicitaria" },
  { avatar: "assets/avatar-santiago.jpg", tagLabel: "Deporte", lead: "Muy interesante la conexión de la neurociencia con el movimiento", rest: "Las clases son súper personalizadas, adaptadas tanto a mis objetivos como a mi flexibilidad y estado de ánimo. MUY recomendado.", author: "Santiago G.", profession: "Profesor de Educación Física" },
  { avatar: "assets/avatar-lucas.jpg", tagLabel: "Rendimiento", lead: "Equilibrio entre entrenamiento, presencia y su sabiduría inmensa", rest: "Hice yoga antes y no encontraba algo dinámico y con esfuerzo físico real como en las clases de Luchi. 100 puntos.", author: "Lucas B.", profession: "Ingeniero electrónico" },
  { avatar: "assets/avatar-ana.jpg", tagLabel: "Primera vez", lead: "Uno se siente libre, en un espacio de reflexión y paz", rest: "Las clases fueron super lindas y toda la info que transmitió fue super útil. Una profe muy sabia.", author: "Ana D.", profession: "Estudiante de Psicología" },
  { avatar: "assets/avatar-ezequiel.jpg", tagLabel: "Personalizado", lead: "Si bien los asanas son los mismos hace milenios, cada clase es única", rest: "Se fluye muy bien entre las ideas que trae a la práctica y los objetivos y capacidades de uno.", author: "Ezequiel D.", profession: "Politólogo" },
  { avatar: "assets/avatar-damian.jpg", tagLabel: "Cuerpo y mente", lead: "Hacer yoga es como una caricia al cuerpo y a la mente", rest: "Lourdes lo lleva a otro nivel.", author: "Damian P.", profession: "IT Project Manager" },
]

const FAQS = [
  { q: "¿Qué necesito para empezar si nunca practiqué?", a: "Solo un mat y un espacio tranquilo donde puedas moverte sin distracciones. Nada de flexibilidad previa ni experiencia: la primera clase la armo justamente para eso." },
  { q: "¿Individuales o grupales: cuál me conviene?", a: "Individual: foco 100% en tus objetivos, tu cuerpo y tus horarios. Grupal: energía compartida, motivación y un valor más accesible. Si tenés una molestia física puntual, empezá 1:1." },
  { q: "¿Necesito equipamiento especial?", a: "No es obligatorio. Si tenés, podés usar bloques, manta y bolster para adaptar posturas y cuidar articulaciones. Si no, improvisamos con lo que haya en casa." },
  { q: "¿Qué aporta la neurociencia al yoga?", a: "Diseñamos la práctica para regular el sistema nervioso, mejorar el sueño, la atención y la gestión del estrés, apoyándonos en respiración, movimiento y hábitos. Además entendés por qué funciona, así lo podés repetir sola/o." },
  { q: "¿Cómo funcionan los packs y la reserva?", a: "Coordinamos el horario y, una vez que elegís tu pack, lo abonás y queda habilitado por 30 días. Después reservás cada clase según los horarios disponibles y te organizás con comodidad." },
  { q: "¿Las clases son online o presenciales?", a: "Las dos. Online por videollamada desde donde estés, y presencial en Buenos Aires a coordinar. Para empresas voy a la oficina o hacemos la sesión remota con el equipo." },
]

const PHASES = [
  { label: "Inhalá", dur: 4, from: 0.62, to: 1 },
  { label: "Sostené", dur: 4, from: 1, to: 1 },
  { label: "Exhalá", dur: 6, from: 1, to: 0.62 },
]
const CYCLE = PHASES.reduce((a, p) => a + p.dur, 0)

const REEL_H = 430
const vid = (n: number) => ({ type: "video" as const, src: `assets/video-${n}.mp4`, ratio: 9 / 16 })
const pic = (src: string, ratio: number) => ({ type: "photo" as const, src: `assets/${src}`, ratio })

const COLUMNS = [
  [vid(1)],
  [pic("clase-grupal-1.jpg", 0.75)],
  [pic("terraza-grupal.jpg", 1.68), pic("online-alumna.jpg", 1.5)],
  [vid(2)],
  [pic("acro-montana.jpg", 0.75)],
  [pic("online-tablet.jpg", 1), pic("online-alumno-azul.jpg", 1.18)],
  [vid(3)],
  [pic("clase-grupal-2.jpg", 0.75)],
  [vid(4)],
  [pic("viaje-practica.jpg", 0.46)],
  [vid(5)],
  [pic("lou-practica-2.jpg", 0.77)],
  [vid(6)],
]

const REEL_LOOP = [...COLUMNS, ...COLUMNS].map((col, ci) => {
  const slotH = (REEL_H - 16 * (col.length - 1)) / col.length
  const wide = Math.max(...col.map((m) => m.ratio))
  const w = Math.round(Math.min(460, Math.max(200, slotH * wide)))
  return {
    w: w + "px",
    items: col.map((m) => ({
      src: m.src,
      isVideo: m.type === "video",
      preload: ci < COLUMNS.length ? "auto" : "metadata",
    })),
  }
})

const STORY_VIEW = STORIES.map((st) => ({
  ...st,
  initials: st.author.split(" ").map((w) => w[0]).join("").replace(".", ""),
}))
const STORY_LOOP = [...STORY_VIEW, ...STORY_VIEW]

const MARQUEE = ["Hatha Yoga", "Neurociencia aplicada", "Respiración 4-4-6", "Anatomía y biomecánica", "Yoga Sūtras de Patañjali", "Ayurveda"]
const MARQUEE_LOOP = [...MARQUEE, ...MARQUEE]

// Orden espejado al de la página, para que el nav no contradiga el scroll.
const NAV_LINKS = [
  { key: "opiniones", href: "#opiniones", label: "Historias" },
  { key: "acerca", href: "#acerca", label: "Sobre Lou" },
  { key: "clases", href: "#clases", label: "Clases" },
  { key: "contacto", href: "#contacto", label: "Contacto" },
  { key: "faq", href: "#faq", label: "FAQ" },
]

// Fuente única del panel de escritorio y del drawer mobile: todos los
// destinos de la página menos el hero, al que se llega por el logo.
const NAV_PANEL = [
  { n: "01", key: "clases", href: "#clases", title: "Clases y packs", desc: "1:1, packs mensuales y programas para empresas." },
  { n: "02", key: "ayuda", href: "#ayuda", title: "Encontrá tu punto de partida", desc: "Estrés, dolor físico, deporte o tu equipo." },
  { n: "03", key: "respirar", href: "#respirar", title: "Respiración 4-4-6", desc: "Probá un minuto de calma ahora mismo." },
  { n: "04", key: "opiniones", href: "#opiniones", title: "Historias de alumnos", desc: "Siete personas contando cómo les cambió la semana." },
  { n: "05", key: "acerca", href: "#acerca", title: "Sobre Lou", desc: "Formación, enfoque y por qué la neurociencia." },
  { n: "06", key: "contacto", href: "#contacto", title: "Empezá esta semana", desc: "Coordinamos día, horario y tu plan." },
  { n: "07", key: "faq", href: "#faq", title: "Preguntas frecuentes", desc: "Equipamiento, formatos, packs y reservas." },
]

// Secciones observadas para marcar el link activo en el nav.
const SECTION_IDS = ["inicio", "ayuda", "respirar", "opiniones", "acerca", "clases", "contacto", "faq"]

const HERO_STATS = [
  { n: "200 h", d: "Certificación Ananda Yoga" },
  { n: "7 años", d: "de práctica e investigación" },
  { n: "Neurociencia", d: "Universidad de Palermo" },
  { n: "Online", d: "y presencial en Buenos Aires" },
]

const CREDENTIALS = [
  { strong: "Profesorado de Yoga, 200 h", rest: " — Instituto Ananda Yoga, Buenos Aires" },
  { strong: "Introducción a la Neurociencia", rest: " — Universidad de Palermo, 2026" },
  { strong: "7 años", rest: " de práctica e investigación activa" },
]

const BENEFITS = [
  { t: "Salir del automático", d: "Regulación del sistema nervioso, clase a clase." },
  { t: "Respirar mejor", d: "Herramientas para bajar ansiedad y tensión física." },
  { t: "Atención clara", d: "Foco para decidir mejor y rendir sin quemarte." },
]

const CTA_ASSURANCE = [
  { n: "01", t: "Charlamos 15 minutos", d: "La primera charla es para conocernos y ver si encajamos, sin compromiso." },
  { n: "02", t: "Horario a medida", d: "Coordinamos según tu semana real, no al revés." },
  { n: "03", t: "Empezás desde cero", d: "No hace falta flexibilidad ni experiencia previa." },
]

type Plan = {
  name: string
  price: string
  unit: string
  desc: string
  feats: { t: string }[]
  btn: string
  href: string
  badge?: string | null
  cardBg: string
  cardBorder: string
  cardShadow: string
  titleColor: string
  mutedColor: string
  bodyColor: string
  tickColor: string
  btnBg: string
  btnColor: string
  btnBorder: string
  badgeBg: string
  badgeColor: string
}

const plan = (o: Partial<Plan>): Plan =>
  ({
    cardBg: "#fff",
    cardBorder: "#F3DADA",
    cardShadow: "0 22px 50px -34px rgba(74,0,0,0.5)",
    titleColor: "#A41D2D",
    mutedColor: "#6B0505",
    bodyColor: "#4A0000",
    tickColor: "#A41D2D",
    btnBg: "transparent",
    btnColor: "#A41D2D",
    btnBorder: "rgba(164,29,45,0.3)",
    badge: null,
    badgeBg: "#FDECEC",
    badgeColor: "#A41D2D",
    ...o,
  }) as Plan

const PLANS: Plan[] = [
  plan({
    name: "Clase individual",
    price: "$22.000",
    unit: "/ clase",
    desc: "Para probar el método o cuando necesitás una sesión puntual.",
    feats: [{ t: "60 min, online o presencial" }, { t: "Plan armado para tu cuerpo" }, { t: "Sin compromiso de continuidad" }],
    btn: "Reservar",
    href: ig("Hola Lou! Quiero reservar una clase individual 🌸"),
  }),
  plan({
    name: "Pack 4 clases",
    price: "$79.900",
    unit: "/ mes",
    badge: "Más elegido",
    cardBg: "linear-gradient(150deg,#A41D2D 0%,#8B1A28 100%)",
    cardBorder: "#A41D2D",
    cardShadow: "0 40px 80px -38px rgba(164,29,45,0.85)",
    titleColor: "#fff",
    mutedColor: "#FFE6E6",
    bodyColor: "#FFF5F5",
    tickColor: "#FFC3DE",
    badgeBg: "rgba(255,255,255,0.2)",
    badgeColor: "#fff",
    btnBg: "#fff",
    btnColor: "#A41D2D",
    btnBorder: "#fff",
    desc: "El ritmo mínimo para que tu sistema nervioso registre el cambio.",
    feats: [{ t: "1 clase por semana, habilitado 30 días" }, { t: "Rutina corta para los días sin clase" }, { t: "Seguimiento por mensaje entre clases" }],
    btn: "Empezar el pack",
    href: ig("Hola Lou! Me interesa el pack de 4 clases 🌸"),
  }),
  plan({
    name: "Empresas",
    price: "A medida",
    unit: "",
    desc: "Pausas activas y programas de bienestar para equipos.",
    feats: [{ t: "Sesiones de 10 a 45 min" }, { t: "Remoto o en tu oficina" }, { t: "Informe de participación del equipo" }],
    btn: "Pedir propuesta",
    href: ig("Hola Lou! Quiero una propuesta de yoga para mi empresa 🌸"),
  }),
]

const IG_LINK = ig("Hola Lou! Vengo de la web y me gustaría reservar una clase de prueba 🌸")
const IG_MEDIT = ig("Hola Lou! Vengo de la web y quiero más información sobre meditación 🌸")
const MAIL_LINK = mail("Consulta desde la web — Yoga ByLou", "Hola Lou!\n\nTe escribo desde la web. Me interesa:\n\n")

const SHOW_PRICES = true

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

export default function YogaLanding() {
  const [intent, setIntent] = useState("estres")
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const panelWrapRef = useRef<HTMLDivElement>(null)
  const panelCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelTriggerRef = useRef<HTMLButtonElement>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement>(null)
  const heroWrapRef = useRef<HTMLDivElement>(null)
  const ctaFloatRef = useRef<HTMLDivElement>(null)
  const secretRef = useRef<HTMLDivElement>(null)
  const breathOrbRef = useRef<HTMLDivElement>(null)
  const breathOrbitRef = useRef<HTMLDivElement>(null)
  const breathLabelRef = useRef<HTMLSpanElement>(null)
  const breathCountRef = useRef<HTMLSpanElement>(null)

  const active = INTENTS.find((i) => i.key === intent) || INTENTS[0]

  // El cierre por hover se retrasa: sin esto, cualquier microsalida del puntero
  // (o un movimiento diagonal rápido) cierra el panel antes de poder usarlo.
  const openPanel = () => {
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
    setPanelOpen(true)
  }
  const closePanelSoon = () => {
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
    panelCloseTimer.current = setTimeout(() => setPanelOpen(false), 160)
  }
  useEffect(() => () => {
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
  }, [])

  const registerVideo = useCallback((el: HTMLVideoElement | null) => {
    if (!el || (el as any).__wired) return
    ;(el as any).__wired = true
    el.muted = true
    el.volume = 0
    el.setAttribute("muted", "")
    el.addEventListener("volumechange", () => {
      if (!el.muted) {
        el.muted = true
        el.volume = 0
      }
    })
    const go = () => el.play().catch(() => {})
    go()
    el.addEventListener("canplay", go, { once: true })
  }, [])

  const pauseOnHover = useCallback((el: HTMLDivElement | null) => {
    if (!el || (el as any).__wired) return
    ;(el as any).__wired = true
    el.addEventListener("mouseenter", () => {
      el.style.animationPlayState = "paused"
    })
    el.addEventListener("mouseleave", () => {
      el.style.animationPlayState = "running"
    })
  }, [])

  // Respiración 4-4-6: orbe que escala y satélite que rota.
  useEffect(() => {
    // Con movimiento reducido el orbe queda quieto en un estado legible.
    if (prefersReducedMotion()) {
      if (breathOrbRef.current) breathOrbRef.current.style.transform = "scale(0.86)"
      if (breathLabelRef.current) breathLabelRef.current.textContent = "Inhalá 4 · Sostené 4 · Exhalá 6"
      if (breathCountRef.current) breathCountRef.current.textContent = ""
      return
    }
    const start = Date.now()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const orb = breathOrbRef.current
      const orbit = breathOrbitRef.current
      if (!orb && !orbit) return
      if (orbit) {
        const r = orbit.getBoundingClientRect()
        if (r.bottom < -200 || r.top > window.innerHeight + 200) return
      }
      let t = ((Date.now() - start) / 1000) % CYCLE
      let phase = PHASES[0]
      for (const p of PHASES) {
        if (t < p.dur) {
          phase = p
          break
        }
        t -= p.dur
      }
      const k = t / phase.dur
      const eased = phase.from === phase.to ? phase.from : phase.from + (phase.to - phase.from) * (0.5 - Math.cos(Math.PI * k) / 2)
      if (orb) orb.style.transform = `scale(${eased.toFixed(4)})`
      if (orbit) orbit.style.transform = `rotate(${(k * 360).toFixed(2)}deg)`
      const label = breathLabelRef.current
      if (label && label.textContent !== phase.label) label.textContent = phase.label
      const count = breathCountRef.current
      if (count) {
        const txt = Math.max(1, Math.ceil(phase.dur - t)) + " seg"
        if (count.textContent !== txt) count.textContent = txt
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Nav condensado al scrollear, parallax del hero, deriva del orbe del CTA.
  // El colapso de links por overflow lo resuelven ahora las media queries.
  useEffect(() => {
    let condensed: boolean | null = null
    let raf: number | null = null

    const frame = () => {
      const y = window.scrollY
      const vh = window.innerHeight

      const nav = navRef.current
      if (nav) {
        const inner = nav.querySelector<HTMLElement>("[data-nav-inner]")
        const word = nav.querySelector<HTMLElement>("[data-nav-word]")
        const logo = nav.querySelector<HTMLElement>("[data-nav-logo]")
        const isCondensed = y > 90
        if (isCondensed !== condensed) {
          condensed = isCondensed
          nav.style.background = isCondensed ? "rgba(253,236,236,0.82)" : "transparent"
          nav.style.backdropFilter = isCondensed ? "blur(18px)" : "none"
          nav.style.boxShadow = isCondensed ? "0 1px 0 rgba(164,29,45,0.12)" : "none"
          if (inner) inner.style.padding = isCondensed ? "10px 34px" : "16px 34px"
          if (word) word.style.fontSize = isCondensed ? "20px" : "25px"
          if (logo) {
            logo.style.width = isCondensed ? "27px" : "34px"
            logo.style.height = isCondensed ? "27px" : "34px"
          }
        }
        // El nav se encoge pero nunca se oculta: el CTA de reserva tiene que
        // seguir a mano mientras se lee la página.
      }

      const heroWrap = heroWrapRef.current
      if (heroWrap) {
        const img = heroWrap.querySelector<HTMLElement>("[data-hero-img]")
        // El scale tiene que cubrir el recorrido del translate o queda hueco.
        // En celular no se aplica: el encuadre lo maneja el CSS y este transform
        // inline le ganaría por especificidad.
        if (img) {
          if (window.innerWidth <= 640) img.style.transform = ""
          else img.style.transform = `scale(1.16) translateY(${Math.max(-28, Math.min(0, -y * 0.035))}px)`
        }
      }

      const ctaFloat = ctaFloatRef.current
      if (ctaFloat) {
        const r = ctaFloat.getBoundingClientRect()
        const p = 1 - (r.top + r.height / 2) / (vh + r.height)
        ctaFloat.style.transform = `translate3d(${(p - 0.5) * -50}px, ${(p - 0.5) * 70}px, 0)`
      }
    }

    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        frame()
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    const t = setTimeout(frame, 60)

    return () => {
      clearTimeout(t)
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  // Reveal on scroll para los [data-reveal].
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Con movimiento reducido no se oculta nada: el contenido ya está visible.
    if (prefersReducedMotion()) return
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-reveal]")]

    nodes.forEach((el) => {
      const kind = el.getAttribute("data-reveal")
      if (kind === "stagger") {
        ;[...el.children].forEach((c, i) => {
          const ch = c as HTMLElement
          ch.style.opacity = "0"
          ch.style.transform = "translateY(40px)"
          ch.style.transition = `opacity .8s ${EASE} ${i * 0.11}s, transform .9s ${EASE} ${i * 0.11}s`
        })
        return
      }
      el.style.opacity = "0"
      el.style.willChange = "opacity, transform"
      if (kind === "up") {
        el.style.transform = "translateY(34px)"
        el.style.transition = `opacity .85s ${EASE}, transform .95s ${EASE}`
      }
      if (kind === "scale") {
        el.style.transform = "scale(.94)"
        el.style.transition = `opacity 1s ${EASE}, transform 1.15s ${EASE}`
      }
      if (kind === "mask") {
        el.style.transform = "translateY(46px)"
        el.style.clipPath = "inset(0 0 100% 0)"
        el.style.transition = `opacity 1s ${EASE}, transform 1.1s ${EASE}, clip-path 1.2s ${EASE}`
      }
    })

    const show = (el: HTMLElement) => {
      const kind = el.getAttribute("data-reveal")
      if (kind === "stagger") {
        ;[...el.children].forEach((c) => {
          const ch = c as HTMLElement
          ch.style.opacity = "1"
          ch.style.transform = "none"
        })
      } else {
        el.style.opacity = "1"
        el.style.transform = "none"
        if (kind === "mask") el.style.clipPath = "inset(0 0 0% 0)"
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            show(e.target as HTMLElement)
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" },
    )
    nodes.forEach((el) => io.observe(el))
    const t = setTimeout(() => {
      nodes.forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) show(el)
      })
    }, 1600)

    return () => {
      clearTimeout(t)
      io.disconnect()
    }
  }, [])

  // El panel se cierra con Escape o con un click afuera. Antes se abría al
  // pasar el mouse por cualquier parte del nav; ahora solo desde su disparador.
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanelOpen(false)
        panelTriggerRef.current?.focus()
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!panelWrapRef.current?.contains(e.target as Node)) setPanelOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [panelOpen])

  // Drawer mobile: bloquea el scroll del fondo y cierra con Escape.
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false)
        drawerTriggerRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener("keydown", onKey)
    }
  }, [drawerOpen])

  // Marca el link de la sección visible. El markup ya traía data-nav-link
  // sin que nadie lo consumiera.
  useEffect(() => {
    const els = SECTION_IDS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActiveSection(visible.target.id)
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Tarjeta de la guía: el hover ya no revela nada, solo realza la foto de fondo.
  useEffect(() => {
    const wrap = secretRef.current
    if (!wrap) return
    const card = wrap.querySelector<HTMLElement>("[data-secret-card]")
    if (!card) return
    const img = wrap.querySelector<HTMLElement>("[data-secret-img]")
    const dot = wrap.querySelector<HTMLElement>("[data-secret-dot]")
    const set = (v: boolean) => {
      if (img) {
        img.style.opacity = v ? "0.42" : "0.24"
        img.style.transform = v ? "scale(1)" : "scale(1.08)"
      }
      if (dot) dot.style.transform = v ? "scale(2.1)" : "scale(1)"
    }
    const on = () => set(true)
    const off = () => set(false)
    card.addEventListener("mouseenter", on)
    card.addEventListener("mouseleave", off)
    return () => {
      card.removeEventListener("mouseenter", on)
      card.removeEventListener("mouseleave", off)
    }
  }, [])

  return (
    <>
      <style>{`
        body { margin:0; background:#FDECEC; font-family:"Geist", ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing:antialiased; color:#4A0000; }
        a { color:#A41D2D; text-decoration:none; }
        a:hover { color:#8B1A28; }
        ::selection { background:#A41D2D; color:#fff; }
        html { scroll-behavior:smooth; }
        @keyframes breathe { 0%{transform:scale(.62)} 21%{transform:scale(1)} 58%{transform:scale(1)} 100%{transform:scale(.62)} }
        @keyframes marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes reelscroll { from{transform:translateX(-50%)} to{transform:translateX(0)} }
        @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-9px)} }

        /* Colores de acento. El bordó (#A41D2D), los rosas pálidos (#FDECEC,
           #FFF5F5) y los oscuros (#6B0505, #4A0000) ya existían y se reutilizan
           tal cual. Estos cuatro son los únicos valores nuevos: manteca como
           luz, fucsia como acento expresivo. */
        :root {
          --butter: #EAD99A;
          /* Variante para manteca sobre fondo claro: el #EAD99A se lava
             sobre blanco. Sigue siendo vainilla, no dorado. */
          --butter-ink: #D2B565;
          --butter-soft: #F7EFD5;
          --butter-wash: #FCF7E8;
          --fucsia: #D75B86;

          /* Escala de radios: tres decisiones reutilizadas en vez de un valor
             distinto por elemento. */
          --r-sm: 7px;   /* etiquetas */
          --r-md: 11px;  /* botones */
          --r-lg: 18px;  /* fotografía */
          --r-xl: 40px;  /* grandes superficies contenidas */

          /* Ritmo vertical. Antes había 96/104/112/120/136px repartidos sin
             lógica; ahora cada sección elige un escalón según su peso. */
          --sp-xl: 84px; /* sección protagonista */
          --sp-lg: 66px; /* sección normal */
          --sp-md: 50px; /* sección compacta */
          --sp-sm: 38px; /* secciones encadenadas */

          /* Anchos de contenido, para dejar de tener un max-width por sección. */
          --content-narrow: 1080px;
          --content-max: 1240px;
          --content-wide: 1380px;

          /* El bordó de marca sin tocar, más una variante para superficies
             grandes: el #A41D2D a pantalla completa cansa la vista. */
          --burgundy-primary: #A41D2D;
          --burgundy-surface: #9B2B3A;
        }

        @media (max-width: 900px) {
          :root {
            --sp-xl: 56px;
            --sp-lg: 46px;
            --sp-md: 36px;
            --sp-sm: 28px;
            --r-xl: 26px;
          }
        }

        /* Los grids viven en CSS y no en el atributo style: los estilos inline
           ganan por especificidad y no habría forma de pisarlos sin !important. */
        .g-hero      { grid-template-columns: 1.15fr 0.85fr; }
        .g-herostats { grid-template-columns: repeat(2,minmax(0,1fr)); }
        .g-guia      { grid-template-columns: minmax(0,1fr) auto; }
        .g-ayuda     { grid-template-columns: 1.28fr 0.72fr; }
        .g-respirar  { grid-template-columns: 0.88fr 1.12fr; }
        .g-reelhead  { grid-template-columns: 1fr auto; }
        .g-acerca    { grid-template-columns: 42fr 58fr; align-items: center; gap: 44px; }

        /* La altura del video la define la columna derecha, no un clamp en vh:
           el grid se estira y el video toma el alto de la fila. Así quedan
           alineados ópticamente en cualquier viewport. */
        @media (min-width: 1101px) {
          .g-acerca { align-items: stretch; }
          /* Sin offset: el video arranca en el tope de la fila, a la altura de
             la tarjeta de perfil, y llega hasta la base de las tres tarjetas. */
          .about-slot {
            flex: 1; min-height: 0; margin-top: 0 !important;
            display: flex; align-items: stretch; justify-content: center;
          }
          .about-video {
            height: 100% !important;
            width: auto !important;
            max-width: 100% !important;
          }
        }
        .g-benefits  { grid-template-columns: repeat(3,1fr); }
        .g-clases    { grid-template-columns: repeat(3,1fr); }
        .g-contacto  { grid-template-columns: 1.1fr 0.9fr; }
        .g-faq       { grid-template-columns: 0.78fr 1.22fr; }
        /* 45 / 55 a favor de la foto. La altura del marco se acota con vh para
           que la sección entre en una pantalla, con topes por si el monitor es
           muy alto o muy bajo. */
        /* 56/44 a favor del texto: la columna angosta anterior partía los
           párrafos en muchas líneas cortas y eso era la altura de más. */
        .g-medit     { grid-template-columns: 56fr 44fr; align-items: stretch; }
        .medit-frame { min-height: 400px; }
        /* Colchón contra la navbar fija: separa sin desperdiciar viewport. */
        /* El header es fijo (~72px): sin esto el ancla deja el encabezado tapado. */
        #meditacion, #acerca, #respirar, #clases, #opiniones, #contacto, #faq, #ayuda { scroll-margin-top: 88px; }
        .g-footer    { grid-template-columns: 1.4fr 1fr; }

        /* Hero: la columna de texto manda, la foto acompaña. */
        .hero-media { max-width: 400px; justify-self: start; width: 100%; }
        .hero-sec   { padding: 96px 34px 56px; }
        /* Sin esto el nav fijo tapa el encabezado al saltar por un ancla. */
        section[id]  { scroll-margin-top: 104px; }
        /* Contenedor más angosto que el resto (1320px): con el ancho completo
           el texto y la foto quedaban pegados a cada borde. */
        .g-hero     { gap: 44px; max-width: var(--content-narrow); }

        @media (max-width: 1100px) {
          /* Apilado: la foto se centra y se achica todavía más. */
          .hero-media { max-width: 340px; justify-self: center; }
        }

        /* Microinteracción: la flecha del CTA de Meditación avanza 4px.
           El bloque prefers-reduced-motion de más abajo la neutraliza. */
        .medit-btn:hover .medit-arrow { transform: translateX(4px); }

        /* Puente invisible sobre los 12px que separan el nav del panel. Esa
           franja no pertenecía a ninguno de los dos, así que al cruzarla se
           disparaba mouseleave y el panel se cerraba antes de poder usarlo.
           Al ser un pseudo-elemento del panel, el puntero nunca "sale". */
        #nav-panel::before {
          content: "";
          position: absolute;
          left: 0; right: 0; top: -14px;
          height: 14px;
        }

        /* Pantallas de escritorio bajas (1366×768 y similares): el problema no
           es el ancho sino el alto, así que se ajusta por max-height y no por
           un breakpoint de ancho. */
        @media (min-width: 1101px) and (max-height: 820px) {
          #acerca { padding-top: 30px !important; padding-bottom: 30px !important; }
          #acerca h2 { font-size: clamp(26px, 2.9vw, 38px) !important; }
          /* Sin override de altura: el video la toma de la fila del grid.
             Fijarla acá pisaba el height:100% y lo dejaba corto. */
        }

        /* Superficies contenidas: el fondo claro rodea la masa de color y la
           transición deja de ser "termina una franja y empieza otra". */
        @media (max-width: 900px) {
          .surface-burgundy { padding: 34px 22px !important; }
          .op-inner { padding: 34px 0 38px !important; gap: 24px !important; }
        }

        .skip-link {
          position: absolute; left: -9999px; top: 8px; z-index: 200;
          padding: 12px 20px; border-radius: 99px;
          background: #4A0000; color: #fff; font-size: 15px; font-weight: 600;
        }
        .skip-link:focus { left: 16px; color: #fff; }
        :focus-visible { outline: 3px solid #A41D2D; outline-offset: 3px; border-radius: 4px; }

        @media (max-width: 1100px) {
          /* La píldora de links se reemplaza por el drawer. */
          .nav-pill, .nav-cta { display: none !important; }
          .nav-burger { display: inline-flex !important; }
          .g-hero, .g-ayuda, .g-respirar, .g-acerca, .g-contacto, .g-faq, .g-medit { grid-template-columns: 1fr; }
          /* Apilado: primero el texto, después la foto (orden natural del DOM). */
          .g-medit { gap: 32px; }
          .medit-media { max-width: 520px; justify-self: center; width: 100%; }
          .medit-frame { height: 320px; }
          .g-clases { grid-template-columns: repeat(2,1fr); }
          .g-guia { grid-template-columns: 1fr; }
          .hero-sec { padding-top: 130px; }
        }

        /* El carrusel escala alto y ancho con el mismo factor. */
        .reel-col { width: calc(var(--reel-w) * var(--reel-k, 1)); height: calc(430px * var(--reel-k, 1)); }
        .story-card { width: 352px; padding: 26px; }
        /* Divisoria de la segunda columna de datos del hero (era inline). */
        .stat-div { border-left: 1px solid rgba(164,29,45,0.18); padding-left: 26px; }

        @media (max-width: 1100px) {
          :root { --reel-k: 0.82; }
        }

        @media (max-width: 760px) {
          .g-clases, .g-benefits, .g-reelhead, .g-footer { grid-template-columns: 1fr; }
          /* Los 4 datos del hero quedan 2x2, no en una columna larguísima. */
          .g-herostats { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
          .g-herostats .stat-div { border-left: 0 !important; padding-left: 0 !important; }
        }

        /* ---- Escala general en celular ----
           Los estilos inline ganan por especificidad, así que este bloque usa
           !important. Es la única forma de reescalar sin reescribir el archivo. */
        @media (max-width: 640px) {
          section, footer { padding-left: 18px !important; padding-right: 18px !important; }
          section { padding-top: 56px !important; padding-bottom: 56px !important; }
          .hero-sec { padding-top: 104px !important; padding-bottom: 40px !important; }
          section[id] { scroll-margin-top: 84px; }

          /* Tipografía */
          h1 { font-size: clamp(29px, 8.4vw, 37px) !important; line-height: 1.08 !important; }
          h2 { font-size: clamp(23px, 6.4vw, 30px) !important; line-height: 1.14 !important; }
          h3 { font-size: 17px !important; }
          section p { font-size: 15px !important; line-height: 1.55 !important; }

          /* Botones: más bajos pero sin bajar de 46px de área táctil. */
          /* Los botones de solo ícono quedan excluidos con :not(). El selector
             de atributo tiene más especificidad que una clase, así que pelearle
             con .nav-burger no alcanzaba y el SVG quedaba aplastado a 0px. */
          a[style*="border-radius:99px"]:not(.icon-btn),
          button[style*="border-radius:99px"]:not(.nav-burger):not(.icon-btn) {
            /* min-height y no height: hay botones cuyo texto envuelve a dos
               líneas y con altura fija quedaban apretados. */
            min-height: 48px !important; height: auto !important;
            padding: 11px 20px !important; font-size: 14.5px !important;
          }
          /* Esta sección lleva su propio padding interno, aparte del <section>. */
          .op-inner { padding-top: 52px !important; padding-bottom: 52px !important; gap: 26px !important; }
          .nav-burger, .icon-btn { width: 42px !important; height: 42px !important; }
          [data-nav-inner] { padding: 12px 18px !important; }
          [data-nav-word] { font-size: 19px !important; }

          /* Hero. El gris de la derecha es la pared del ambiente, parte de la
             foto: para sacarlo hay que encuadrar más cerca. scale + translateX
             recortan por derecha y dejan la cabeza y el rodete centrados. */
          .hero-img {
            transform: scale(1.62) translateX(11%) !important;
            object-position: 50% 20% !important;
          }
          .hero-media { max-width: 240px !important; }
          .hero-note {
            left: -14px !important; bottom: 26px !important;
            padding: 12px 15px !important; max-width: 176px !important;
            border-radius: 16px !important; gap: 5px !important;
          }
          .hero-note span:first-child { font-size: 9.5px !important; letter-spacing: 0.13em !important; }
          .hero-note span:last-child { font-size: 12.5px !important; line-height: 1.35 !important; }
          .g-hero { gap: 26px !important; }
          .stat-n { font-size: 21px !important; }
          .stat-d { font-size: 11.5px !important; }

          /* Respiración: el orbe seguía midiendo 340px de alto reservado. */
          .breath-wrap { height: 210px !important; }
          .breath-box { width: 200px !important; height: 200px !important; }
          .g-respirar { gap: 26px !important; }
          .breath-benes { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 14px !important; }
          .breath-benes span:first-child { font-size: 18px !important; }
          .breath-benes span:last-child { font-size: 12px !important; }

          /* Carrusel de fotos y videos: ~55% del alto de pantalla. */
          :root { --reel-k: 0.56; }

          /* Testimonios: se ve una tarjeta y asoma la siguiente. */
          .story-card { width: 78vw !important; max-width: 300px !important; padding: 18px !important; gap: 9px !important; }
          .story-lead { font-size: 17px !important; }
          .story-rest { font-size: 13.5px !important; }

          /* Meditación: más compacta y con la foto en formato menos alto,
             para que la sección no se coma varias pantallas. */
          .g-medit { gap: 26px !important; }
          .medit-sub { font-size: 17px !important; line-height: 1.45 !important; }
          .medit-body { gap: 14px !important; margin-top: 22px !important; }
          .medit-body p { font-size: 15px !important; line-height: 1.65 !important; }
          .medit-media { max-width: 100% !important; }
          .medit-frame { height: 260px !important; }
          /* En celular manda el ancho y el alto lo deriva el 9/16. Fijando el
             alto, el ancho calculado superaba el viewport y desbordaba. */
          .about-video { width: min(100%, 320px) !important; height: auto !important; }
          /* Sin esto las columnas del grid no se dejan encoger por debajo de
             su contenido y empujan el ancho de la página. */
          .g-acerca > * { min-width: 0; }
          /* Botón a todo el ancho para que sea cómodo de tocar. */
          .medit-cta { margin-top: 18px !important; gap: 10px !important; align-self: stretch; }
          .medit-btn { width: 100% !important; height: 46px !important; font-size: 14.5px !important; }
          #meditacion { padding-top: 48px !important; padding-bottom: 48px !important; }

          .g-contacto { padding: 44px 20px !important; }
          .g-guia { padding: 34px 20px !important; }
        }

        @media (max-width: 380px) {
          .story-card { width: 82vw !important; }
          .hero-media { max-width: 210px !important; }
        }

        /* Sin esto la página es hostil para quien tiene sensibilidad vestibular:
           hay tres carruseles infinitos corriendo a la vez. */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <div ref={rootRef} style={s("background:#FDECEC;overflow-x:hidden")}>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <header ref={navRef} style={s("position:fixed;top:0;left:0;right:0;z-index:90;transition:transform .5s cubic-bezier(.22,.61,.36,1),background .4s,box-shadow .4s,backdrop-filter .4s;will-change:transform")}>
          <div data-nav-inner="" style={s("max-width:1320px;margin:0 auto;padding:16px 34px;display:flex;align-items:center;justify-content:space-between;gap:28px;transition:padding .4s cubic-bezier(.22,.61,.36,1)")}>
            <a href="#inicio" style={s("display:flex;align-items:center;gap:12px;flex-shrink:0")}>
              <img data-nav-logo="" src={A("assets/ginkgo.png")} alt="" style={s("width:34px;height:34px;flex-shrink:0;transition:width .4s,height .4s")} />
              <span data-nav-word="" style={s("font-family:'Playfair Display',serif;font-size:25px;font-weight:500;letter-spacing:-0.015em;color:#4A0000;white-space:nowrap;transition:font-size .4s")}>Yoga ByLou</span>
            </a>

            <nav
              aria-label="Principal"
              className="nav-pill"
              ref={panelWrapRef}
              onMouseLeave={closePanelSoon}
              onMouseEnter={() => { if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current) }}
              style={s("position:relative;display:flex;align-items:center;gap:6px;padding:5px;border-radius:14px;background:rgba(255,255,255,0.78);border:1px solid rgba(164,29,45,0.12);backdrop-filter:blur(16px);box-shadow:0 8px 30px -18px rgba(74,0,0,0.5)")}
            >
              {NAV_LINKS.map((l) => {
                const on = activeSection === l.key
                return (
                  <Hov
                    key={l.key}
                    tag="a"
                    href={l.href}
                    data-nav-link={l.key}
                    aria-current={on ? "true" : undefined}
                    css="padding:9px 16px;border-radius:9px;font-size:14px;font-weight:500;transition:background .25s,color .25s;white-space:nowrap"
                    hover="background:#FDECEC;color:#A41D2D"
                    style={on ? { background: "#FDECEC", color: "#A41D2D", fontWeight: 600 } : { color: "#6B0505" }}
                  >
                    {l.label}
                    {/* Punto fucsia: marca la sección activa sin sumar otro color de fondo. */}
                    {on && <span style={s("display:inline-block;width:4px;height:4px;border-radius:99px;background:var(--fucsia);margin-left:7px;vertical-align:middle")} />}
                  </Hov>
                )
              })}

              <button
                ref={panelTriggerRef}
                type="button"
                aria-haspopup="true"
                aria-expanded={panelOpen}
                aria-controls="nav-panel"
                onClick={() => setPanelOpen((v) => !v)}
                onMouseEnter={openPanel}
                style={s("display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:9px;font-size:14px;font-weight:500;color:#6B0505;white-space:nowrap;background:transparent;border:0;font-family:inherit;cursor:pointer")}
              >
                Explorar
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform .3s", transform: panelOpen ? "rotate(180deg)" : "none" }}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <div
                id="nav-panel"
                data-nav-panel=""
                onMouseEnter={openPanel}
                onMouseLeave={closePanelSoon}
                style={{
                  ...s("position:absolute;top:calc(100% + 12px);right:0;width:330px;padding:8px;border-radius:20px;background:#fff;border:1px solid rgba(164,29,45,0.12);box-shadow:0 30px 70px -34px rgba(74,0,0,0.5);transform-origin:top right;transition:opacity .28s cubic-bezier(.22,.61,.36,1),transform .28s cubic-bezier(.22,.61,.36,1),visibility .28s"),
                  opacity: panelOpen ? 1 : 0,
                  visibility: panelOpen ? "visible" : "hidden",
                  transform: panelOpen ? "none" : "translateY(-10px) scale(.98)",
                  pointerEvents: panelOpen ? "auto" : "none",
                }}
              >
                {/* Lista compacta: con descripciones y a dos columnas el panel
                    tapaba medio hero. */}
                <div style={s("display:flex;flex-direction:column;gap:1px")}>
                  {NAV_PANEL.map((p) => (
                    <Hov key={p.n} tag="a" href={p.href} onClick={() => setPanelOpen(false)} tabIndex={panelOpen ? undefined : -1} css="display:flex;gap:11px;align-items:center;padding:10px 12px;border-radius:12px;transition:background .2s" hover="background:#FFF5F5">
                      <span style={s("flex-shrink:0;font-family:'Playfair Display',serif;font-size:13px;color:#C98B95;min-width:19px")}>{p.n}</span>
                      <span style={s("font-size:14.5px;font-weight:500;color:#4A0000")}>{p.title}</span>
                    </Hov>
                  ))}
                </div>
              </div>
            </nav>

            <button
              ref={drawerTriggerRef}
              type="button"
              className="nav-burger"
              aria-label="Abrir menú"
              aria-expanded={drawerOpen}
              aria-controls="nav-drawer"
              onClick={() => setDrawerOpen(true)}
              style={s("display:none;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0;border-radius:99px;background:#fff;border:1px solid rgba(164,29,45,0.16);color:#A41D2D;cursor:pointer")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>

            <Hov tag="a" href={IG_LINK} target="_blank" rel="noopener noreferrer" className="nav-cta" css="position:relative;overflow:hidden;flex-shrink:0;display:inline-flex;align-items:center;gap:11px;height:46px;padding:0 22px;border-radius:var(--r-md);background:#A41D2D;color:#fff;font-size:14.5px;font-weight:600;white-space:nowrap;box-shadow:0 6px 18px -10px rgba(164,29,45,0.7);transition:transform .3s cubic-bezier(.22,.61,.36,1),box-shadow .3s" hover="transform:translateY(-2px);box-shadow:0 22px 44px -16px rgba(164,29,45,0.9)">
              <span data-cta-label="" style={s("position:relative")}>Reservar clase de prueba</span>
              <ArrowIcon size={16} />
            </Hov>
          </div>
        </header>

        {/* Drawer mobile: antes el chip "Menú" no abría nada y estas secciones
            no tenían ninguna entrada en pantallas chicas. */}
        <div
          id="nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
          hidden={!drawerOpen}
          style={{
            ...s("position:fixed;inset:0;z-index:100;background:#FDECEC;overflow-y:auto;padding:20px"),
            display: drawerOpen ? "block" : "none",
          }}
        >
          <div style={s("max-width:560px;margin:0 auto")}>
          <div style={s("display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px")}>
            <span style={s("display:flex;align-items:center;gap:11px")}>
              <img src={A("assets/ginkgo.png")} alt="" style={s("width:30px;height:30px")} />
              <span style={s("font-family:'Playfair Display',serif;font-size:22px;color:#4A0000")}>Yoga ByLou</span>
            </span>
            <button
              type="button"
              aria-label="Cerrar menú"
              className="icon-btn"
              onClick={() => {
                setDrawerOpen(false)
                drawerTriggerRef.current?.focus()
              }}
              style={s("display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:99px;background:#fff;border:1px solid rgba(164,29,45,0.16);color:#A41D2D;cursor:pointer")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div style={s("display:flex;flex-direction:column;gap:6px")}>
            {NAV_PANEL.map((p) => (
              <a
                key={p.n}
                href={p.href}
                onClick={() => setDrawerOpen(false)}
                style={{
                  ...s("display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:18px;background:#fff;border:1px solid #F3DADA"),
                  ...(activeSection === p.key ? { borderColor: "#A41D2D" } : {}),
                }}
              >
                <span style={s("flex-shrink:0;width:38px;height:38px;border-radius:12px;background:#FDECEC;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:16px;color:#A41D2D")}>{p.n}</span>
                <span style={s("display:flex;flex-direction:column;gap:3px")}>
                  <span style={s("font-size:16px;font-weight:600;color:#4A0000")}>{p.title}</span>
                  <span style={s("font-size:14px;line-height:1.45;color:#6B0505")}>{p.desc}</span>
                </span>
              </a>
            ))}
          </div>

          <a
            href={IG_LINK}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setDrawerOpen(false)}
            style={s("margin-top:22px;display:flex;align-items:center;justify-content:center;gap:11px;height:60px;border-radius:99px;background:#A41D2D;color:#fff;font-size:16px;font-weight:600")}
          >
            Reservar clase de prueba
            <ArrowIcon size={16} />
          </a>
          </div>
        </div>

        <main id="contenido">
        <section id="inicio" className="hero-sec" style={s("position:relative;display:flex;align-items:center;background:linear-gradient(180deg,#FFF8F8 0%,#FDECEC 70%,#FBE2E2 100%)")}>
          <div className="g-hero" style={s("margin:0 auto;width:100%;display:grid;align-items:center")}>
            <div style={s("display:flex;flex-direction:column;align-items:flex-start;gap:28px")}>
              <span data-reveal="up" style={s("display:inline-flex;align-items:center;gap:10px;padding:9px 18px 9px 12px;border-radius:99px;background:rgba(255,255,255,0.9);border:1px solid rgba(164,29,45,0.16);font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#A41D2D;white-space:nowrap;backdrop-filter:blur(8px)")}>
                <img src={A("assets/ginkgo.png")} alt="" style={s("width:17px;height:17px;flex-shrink:0")} />
                Yoga + neurociencia aplicada
                {/* Único acento del hero: un punto manteca al cierre del badge. */}
                <span style={s("width:5px;height:5px;border-radius:99px;background:var(--butter);flex:none;margin-left:2px")} />
              </span>
              {/* Reveal "up" y no "mask": el clip-path del mask recortaba la
                  frase mientras animaba, sobre todo la itálica de Playfair. */}
              <h1 data-reveal="up" style={s("margin:0;font-family:'Playfair Display',ui-serif,Georgia,serif;font-size:clamp(38px,5.4vw,68px);line-height:1.02;letter-spacing:-0.035em;color:#4A0000;text-wrap:balance;padding-bottom:0.08em")}>
                Regulá tu
                <br />
                <em style={s("font-style:italic;color:#A41D2D")}>sistema nervioso</em>
              </h1>
              <p data-reveal="up" style={s("margin:0;font-size:20px;line-height:1.55;max-width:500px;color:#6B0505;text-wrap:pretty")}>
                Clases 1:1 y grupales que combinan Hatha Yoga con neurociencia práctica. Menos ansiedad, mejor sueño y una atención que te devuelve el día.
              </p>
              <div data-reveal="up" style={s("display:flex;flex-wrap:wrap;gap:13px;align-items:center")}>
                <Hov tag="a" href={IG_LINK} target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:11px;height:60px;padding:0 32px;border-radius:99px;background:#A41D2D;color:#fff;font-size:16.5px;font-weight:600;box-shadow:0 18px 40px -16px rgba(164,29,45,0.9);transition:transform .3s cubic-bezier(.22,.61,.36,1),box-shadow .3s" hover="transform:translateY(-3px);box-shadow:0 28px 54px -18px rgba(164,29,45,0.95)">
                  Reservar clase de prueba
                  <ArrowIcon />
                </Hov>
                <Hov tag="a" href="#respirar" css="display:inline-flex;align-items:center;gap:10px;height:60px;padding:0 28px;border-radius:99px;background:transparent;border:1.5px solid rgba(164,29,45,0.32);color:#A41D2D;font-size:16px;font-weight:600;transition:background .28s,border-color .28s" hover="background:#fff;border-color:#A41D2D">
                  Probá 1 minuto de calma
                </Hov>
              </div>
              {/* Sin <br /> forzados: en celular partían mal y alargaban la
                  columna. El ancho lo define la grilla. */}
              <div data-reveal="stagger" className="g-herostats" style={s("display:grid;gap:22px 26px;padding-top:12px;width:100%;max-width:500px")}>
                {HERO_STATS.map((st, i) => (
                  <div key={st.n} className={i % 2 === 1 ? "stat stat-div" : "stat"} style={s("display:flex;flex-direction:column;gap:2px")}>
                    <span className="stat-n" style={s("font-family:'Playfair Display',serif;font-size:27px;line-height:1.1;color:#A41D2D")}>{st.n}</span>
                    <span className="stat-d" style={s("font-size:12.5px;line-height:1.35;color:#6B0505")}>{st.d}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* La foto se cap a un ancho fijo: a 4/5 y 100% del ancho de columna
                se comía toda la altura de pantalla en monitores grandes. */}
            <div data-reveal="scale" className="hero-media" style={s("position:relative")}>
              <div style={s("position:absolute;inset:-30px;border-radius:220px 220px 30px 30px;background:radial-gradient(circle at 40% 20%, rgba(255,214,234,0.9), rgba(253,236,236,0));filter:blur(30px)")} />
              <div ref={heroWrapRef} style={s("position:relative;border-radius:280px 280px 30px 30px;overflow:hidden;box-shadow:0 50px 90px -40px rgba(74,0,0,0.65)")}>
                {/* scale 1.16 (antes 1.06): el parallax desplaza la imagen hasta
                    40px hacia arriba y dejaba una franja vacía abajo del marco.
                    object-position 50% 18% conserva el rodete. */}
                <img data-hero-img="" className="hero-img" src={A("assets/louyoga.jpg")} alt="Lourdes Populin" style={s("width:100%;aspect-ratio:4/5;object-fit:cover;object-position:50% 18%;display:block;transform:scale(1.16);will-change:transform")} />
              </div>
              <div className="hero-note" style={s("position:absolute;left:-40px;bottom:62px;background:#fff;border-radius:22px;padding:18px 22px;box-shadow:0 30px 60px -26px rgba(74,0,0,0.5);display:flex;flex-direction:column;gap:7px;max-width:228px;animation:floaty 7s ease-in-out infinite")}>
                <span style={s("font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#A41D2D")}>Primera sesión</span>
                <span style={s("font-size:14.5px;line-height:1.42;color:#4A0000")}>Charlamos 15 min, armamos tu plan y practicás. Sin compromiso.</span>
              </div>
            </div>
          </div>
        </section>

        <div style={s("border-top:1px solid rgba(164,29,45,0.12);border-bottom:1px solid rgba(164,29,45,0.12);background:#FFF5F5;overflow:hidden;padding:15px 0")}>
          <div style={s("display:flex;width:max-content;gap:54px;animation:marquee 38s linear infinite")}>
            {MARQUEE_LOOP.map((label, i) => (
              <span key={i} style={s("display:inline-flex;align-items:center;gap:54px;font-size:12.5px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:rgba(107,5,5,0.55);white-space:nowrap")}>
                {label}
                <span style={s("width:5px;height:5px;border-radius:99px;background:#E8C5C5")} />
              </span>
            ))}
          </div>
        </div>

        <section style={s("background:#FDECEC;padding:var(--sp-lg) 34px")}>
          <div ref={secretRef} style={s("max-width:1320px;margin:0 auto")}>
            <div data-secret-card="" style={s("position:relative;overflow:hidden;border-radius:34px;background:#4A0000;box-shadow:0 40px 90px -50px rgba(74,0,0,0.9)")}>
              <img data-secret-img="" src={A("assets/lou-practica-2.jpg")} alt="" style={s("position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.24;transform:scale(1.08);transition:opacity .8s cubic-bezier(.22,.61,.36,1),transform 1.1s cubic-bezier(.22,.61,.36,1);will-change:transform")} />
              <div style={s("position:absolute;inset:0;background:linear-gradient(100deg,#4A0000 12%,rgba(74,0,0,0.72) 52%,rgba(74,0,0,0.35) 100%)")} />

              <div className="g-guia" style={s("position:relative;display:grid;gap:48px;align-items:center;padding:66px 60px;min-height:300px")}>
                <div style={s("position:relative;min-width:0;display:flex;flex-direction:column;gap:0")}>
                  <span style={s("display:inline-flex;align-items:center;gap:10px;font-size:11.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#FF8EBE;margin-bottom:20px")}>
                    <span data-secret-dot="" style={s("width:7px;height:7px;border-radius:99px;background:#FF8EBE;transition:transform .5s")} />
                    Tenemos algo para vos
                  </span>

                  {/* La oferta se lee siempre. Antes vivía detrás del hover y
                      quien scrolleaba rápido nunca se enteraba de que existía. */}
                  <div style={s("max-width:100%")}>
                    <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(34px,3.6vw,52px);line-height:1.04;letter-spacing:-0.03em;color:#fff;max-width:100%;display:flex;align-items:center;gap:0.24em;flex-wrap:wrap")}>
                      <img src={A("assets/sparkles.png")} alt="" style={s("width:0.92em;height:0.92em;object-fit:contain;flex:none")} />
                      <span>
                        Tu guía de Yoga y Neurociencia, <em style={s("font-style:italic;color:#FF8EBE")}>gratis</em>
                      </span>
                    </h2>
                    <p style={s("margin:18px 0 0;font-size:17px;line-height:1.55;color:rgba(255,255,255,0.78);max-width:560px")}>
                      Ejercicios simples para volver al presente en el medio del día, con la explicación de qué le pasa a tu cerebro en cada uno.
                    </p>
                  </div>
                </div>

                <div data-secret-action="" style={s("display:flex;flex-direction:column;align-items:flex-end;gap:16px")}>
                  <Hov tag="a" href="https://forms.gle/w2CcwYfKJZMdxKns6" target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:11px;height:60px;padding:0 32px;border-radius:99px;background:#fff;color:#A41D2D;font-size:16px;font-weight:600;box-shadow:0 22px 46px -20px rgba(0,0,0,0.7);transition:transform .3s cubic-bezier(.22,.61,.36,1)" hover="transform:translateY(-3px)">
                    Recibir la guía
                    <ArrowIcon />
                  </Hov>
                  <span style={s("font-size:13px;color:rgba(255,255,255,0.55)")}>PDF · llega a tu mail al instante</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="ayuda" style={s("background:#FDECEC;padding:var(--sp-sm) 34px var(--sp-lg)")}>
          <div style={s("max-width:1320px;margin:0 auto")}>
            <div data-reveal="up" style={s("display:flex;flex-direction:column;gap:16px;max-width:680px;margin-bottom:46px")}>
              <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#A41D2D")}>Empecemos por vos</span>
              <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(29px,3.6vw,46px);line-height:1.04;letter-spacing:-0.03em;color:#4A0000")}>¿Qué te trae hasta acá?</h2>
              <p style={s("margin:0;font-size:17.5px;line-height:1.55;color:#6B0505")}>Elegí lo que más te resuena y te muestro exactamente cómo trabajaríamos. El botón abre el mensaje ya escrito: solo lo enviás.</p>
            </div>

            <div data-reveal="up" style={s("display:flex;flex-wrap:wrap;gap:10px;margin-bottom:30px")}>
              {INTENTS.map((it) => {
                const on = it.key === intent
                return (
                  <button
                    key={it.key}
                    onClick={() => setIntent(it.key)}
                    style={{
                      ...s("height:50px;padding:0 24px;border-radius:99px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .3s cubic-bezier(.22,.61,.36,1)"),
                      border: `1.5px solid ${on ? "#A41D2D" : "rgba(164,29,45,0.16)"}`,
                      background: on ? "#A41D2D" : "#fff",
                      color: on ? "#fff" : "#6B0505",
                      boxShadow: on ? "0 16px 34px -18px rgba(164,29,45,0.9)" : "0 8px 20px -18px rgba(74,0,0,0.5)",
                    }}
                  >
                    {it.chip}
                  </button>
                )
              })}
            </div>

            <div data-reveal="up" className="g-ayuda" style={s("display:grid;gap:0;border-radius:32px;overflow:hidden;background:#fff;box-shadow:0 44px 90px -52px rgba(74,0,0,0.7)")}>
              <div style={s("padding:50px 54px;display:flex;flex-direction:column;gap:24px")}>
                <h3 style={s("margin:0;font-family:'Playfair Display',serif;font-size:34px;line-height:1.12;letter-spacing:-0.02em;color:#4A0000")}>{active.title}</h3>
                <p style={s("margin:0;font-size:17px;line-height:1.6;color:#6B0505")}>{active.intro}</p>
                <div style={s("display:flex;flex-direction:column;gap:13px")}>
                  {active.points.map((p, i) => (
                    <div key={i} style={s("display:flex;gap:13px;align-items:flex-start")}>
                      <span style={s("flex-shrink:0;width:23px;height:23px;border-radius:99px;background:#FDECEC;display:flex;align-items:center;justify-content:center;margin-top:2px")}>
                        <CheckIcon />
                      </span>
                      <span style={s("font-size:16.5px;line-height:1.5;color:#4A0000")}>{p.t}</span>
                    </div>
                  ))}
                </div>
                <div style={s("display:flex;flex-wrap:wrap;gap:11px;align-items:center;padding-top:8px")}>
                  <Hov tag="a" href={ig(active.msg)} target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 28px;border-radius:99px;background:#A41D2D;color:#fff;font-size:15.5px;font-weight:600;box-shadow:0 16px 36px -16px rgba(164,29,45,0.9);transition:transform .3s cubic-bezier(.22,.61,.36,1)" hover="transform:translateY(-3px)">
                    <IgIcon />
                    {active.cta}
                  </Hov>
                  <Hov tag="a" href={mail(`Consulta: ${active.chip}`, `Hola Lou!\n\n${active.msg}\n\n`)} css="display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 26px;border-radius:99px;border:1.5px solid rgba(164,29,45,0.28);color:#A41D2D;font-size:15px;font-weight:600;transition:background .28s,border-color .28s" hover="background:#FDECEC;border-color:#A41D2D">
                    <MailIcon />
                    Prefiero email
                  </Hov>
                </div>
              </div>
              <div style={s("position:relative;background:#FFF5F5;padding:50px 42px;display:flex;flex-direction:column;justify-content:space-between;gap:28px;border-left:1px solid #F3DADA")}>
                <div style={s("display:flex;flex-direction:column;gap:10px")}>
                  <span style={s("font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#A41D2D")}>Formato sugerido</span>
                  <span style={s("font-family:'Playfair Display',serif;font-size:27px;line-height:1.18;color:#4A0000")}>{active.format}</span>
                  <span style={s("font-size:14.5px;line-height:1.5;color:#6B0505")}>{active.formatNote}</span>
                </div>
                <div style={s("border-top:1px solid #F3DADA;padding-top:24px;display:flex;flex-direction:column;gap:11px")}>
                  <span style={s("font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#A41D2D")}>Lo que dicen</span>
                  <p style={s("margin:0;font-size:15px;line-height:1.6;font-style:italic;color:#4A0000")}>“{active.quote}”</p>
                  <span style={s("font-size:13.5px;font-weight:600;color:#A41D2D")}>{active.quoteBy}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* El bordó deja de ir de borde a borde y pasa a ser una pieza
            contenida con radio. La superficie usa la variante suavizada. */}
        <section id="respirar" style={s("background:#FFF5F5;padding:var(--sp-lg) 26px")}>
          <div className="surface-burgundy" style={s("position:relative;overflow:hidden;max-width:var(--content-max);margin:0 auto;border-radius:var(--r-xl);background:var(--burgundy-surface);padding:44px 44px")}>
          <div style={s("position:absolute;inset:0;background:radial-gradient(ellipse 60% 70% at 50% 40%, rgba(255,255,255,0.14), transparent 70%)")} />
          <div className="g-respirar" style={s("position:relative;max-width:1080px;margin:0 auto;display:grid;gap:56px;align-items:center")}>
            <div data-reveal="scale" className="breath-wrap" style={s("display:flex;align-items:center;justify-content:center;height:340px")}>
              <div className="breath-box" style={s("position:relative;width:300px;height:300px;display:flex;align-items:center;justify-content:center")}>
                <div style={s("position:absolute;inset:6px;border-radius:99px;border:1px solid rgba(255,255,255,0.22)")} />
                <div ref={breathOrbRef} style={s("position:absolute;width:250px;height:250px;border-radius:99px;background:radial-gradient(circle at 50% 46%, #FFF7C9 0%, #FFE9A8 16%, #FFD3C4 38%, #FFB9CE 62%, #FFA6C4 82%, #FF9BBE 100%);box-shadow:0 0 90px rgba(255,214,234,0.55);will-change:transform")} />
                <div ref={breathOrbitRef} style={s("position:absolute;inset:0;will-change:transform")}>
                  <span style={s("position:absolute;top:0;left:50%;margin-left:-6px;width:12px;height:12px;border-radius:99px;background:#fff;box-shadow:0 0 16px 4px rgba(255,255,255,0.75)")} />
                </div>
                <span style={s("position:relative;display:flex;flex-direction:column;align-items:center;gap:2px")}>
                  <span ref={breathLabelRef} style={s("font-family:'Playfair Display',serif;font-size:30px;line-height:1.1;color:#8B1A28")}>Inhalá</span>
                  <span ref={breathCountRef} style={s("font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(139,26,40,0.62)")}>4 seg</span>
                </span>
              </div>
            </div>
            <div data-reveal="up" style={s("display:flex;flex-direction:column;gap:22px;color:#fff")}>
              <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#FFC3DE")}>Probalo ahora · 4-4-6</span>
              <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(28px,3.4vw,44px);line-height:1.04;letter-spacing:-0.03em")}>Un minuto y tu cuerpo ya cambió</h2>
              <p style={s("margin:0;font-size:18px;line-height:1.6;color:#FFE6E6;max-width:490px")}>
                Seguí el círculo: inhalá 4, retené 4, exhalá 6. Una exhalación más larga que la inhalación activa tu sistema nervioso parasimpático — la misma respiración con la que abrimos cada clase.
              </p>
              <div className="breath-benes" style={s("display:flex;gap:30px;padding-top:8px;flex-wrap:wrap")}>
                <div style={s("display:flex;flex-direction:column")}>
                  <span style={s("font-family:'Playfair Display',serif;font-size:25px;color:#fff")}>↓ Cortisol</span>
                  <span style={s("font-size:13px;color:#FFC3DE")}>menos estrés agudo</span>
                </div>
                <div style={s("display:flex;flex-direction:column")}>
                  <span style={s("font-family:'Playfair Display',serif;font-size:25px;color:#fff")}>↑ Ondas alpha</span>
                  <span style={s("font-size:13px;color:#FFC3DE")}>calma y claridad</span>
                </div>
                <div style={s("display:flex;flex-direction:column")}>
                  <span style={s("font-family:'Playfair Display',serif;font-size:25px;color:#fff")}>↑ Sueño</span>
                  <span style={s("font-size:13px;color:#FFC3DE")}>te dormís más rápido</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </section>

        <section style={s("background:#FDECEC;padding:var(--sp-md) 34px")}>
          <div style={s("max-width:1320px;margin:0 auto")}>
            <div data-reveal="up" className="g-reelhead" style={s("display:grid;gap:40px;align-items:end;margin-bottom:24px")}>
              <div style={s("display:flex;flex-direction:column;gap:18px")}>
                <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#A41D2D")}>La práctica, por dentro</span>
                <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(32px,4.4vw,56px);line-height:1;letter-spacing:-0.035em;color:#4A0000")}>
                  Un espacio para
                  <br />
                  <em style={s("font-style:italic;color:#A41D2D")}>volver a vos</em>
                </h2>
              </div>
              <p style={s("margin:0 0 8px;font-size:16.5px;line-height:1.6;color:#6B0505;max-width:330px")}>Estudio, terraza, montaña o tu living por videollamada. La práctica se adapta al lugar donde estés y al cuerpo con el que llegás.</p>
            </div>

            <div style={s("display:flex;flex-direction:column;gap:28px")}>
              <div style={s("overflow:hidden;width:100%;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 4%,#000 96%,transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 4%,#000 96%,transparent 100%)")}>
                <div ref={pauseOnHover} style={s("display:flex;align-items:flex-start;gap:16px;padding-right:16px;width:max-content;animation:reelscroll 96s linear infinite")}>
                  {/* El ancho de cada columna lo calcula JS a partir de REEL_H.
                      --reel-w + --reel-k escalan alto y ancho juntos, así la
                      proporción se mantiene al achicar en celular. */}
                  {REEL_LOOP.map((col, ci) => (
                    <div key={ci} className="reel-col" style={{ ...s("flex:none;display:flex;flex-direction:column;gap:16px"), ["--reel-w" as string]: col.w } as React.CSSProperties}>
                      {col.items.map((m, mi) => (
                        <div key={mi} style={s("position:relative;flex:1;min-height:0;border-radius:22px;overflow:hidden;background:#2A0007;box-shadow:0 30px 58px -34px rgba(74,0,0,0.7)")}>
                          {m.isVideo ? (
                            <video ref={registerVideo} src={A(m.src)} autoPlay muted loop playsInline preload={m.preload} style={s("width:100%;height:100%;object-fit:cover;display:block")} />
                          ) : (
                            <img src={A(m.src)} alt="" loading="lazy" style={s("width:100%;height:100%;object-fit:cover;display:block")} />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div style={s("display:flex;align-items:center;gap:18px;flex-wrap:wrap")}>
                <Hov tag="a" href="https://www.instagram.com/bylou.yoga" target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:9px;height:50px;padding:0 24px;border-radius:99px;border:1.5px solid rgba(164,29,45,0.28);color:#A41D2D;font-size:15px;font-weight:600;transition:background .28s,border-color .28s" hover="background:#FDECEC;border-color:#A41D2D">
                  <IgIcon />
                  Ver más en @bylou.yoga
                </Hov>
                <span style={s("font-size:14.5px;color:#6B0505")}>Tips, prácticas cortas y el día a día de ByLou Yoga.</span>
              </div>
            </div>
          </div>
        </section>

        <section id="opiniones" style={s("background:#FDECEC;padding:var(--sp-lg) 26px")}>
          <div className="surface-dark" style={s("position:relative;overflow:hidden;max-width:var(--content-wide);margin:0 auto;border-radius:var(--r-xl);background:#4A0000")}>
          <div className="op-inner" style={s("display:flex;flex-direction:column;gap:30px;padding:52px 0 56px")}>
            <div style={s("max-width:1320px;width:100%;margin:0 auto;padding:0 34px;display:flex;align-items:flex-end;justify-content:space-between;gap:48px;flex-wrap:wrap")}>
              <div style={s("display:flex;flex-direction:column;gap:15px;max-width:600px")}>
                <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--fucsia)")}>Opiniones reales</span>
                <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(32px,4vw,54px);line-height:1.04;letter-spacing:-0.03em;color:#fff")}>Gente parecida a vos</h2>
              </div>
            </div>

            <div style={s("overflow:hidden;width:100%")}>
              <div ref={pauseOnHover} style={s("display:flex;gap:18px;padding-right:18px;width:max-content;will-change:transform;animation:reelscroll 72s linear infinite;animation-direction:reverse")}>
                {/* Sin height fija: al ser un contenedor flex, todas se igualan
                    a la más alta y desaparece el bloque blanco vacío. */}
                {STORY_LOOP.map((st, i) => (
                  <Hov key={i} tag="article" className="story-card" css="position:relative;flex:none;border-radius:22px;overflow:hidden;background:#fff;display:flex;flex-direction:column;gap:12px;box-shadow:0 40px 80px -46px rgba(0,0,0,0.9);transition:transform .45s cubic-bezier(.22,.61,.36,1),box-shadow .45s" hover="transform:translateY(-8px);box-shadow:0 54px 94px -44px rgba(0,0,0,0.95)">
                    <div style={s("display:flex;align-items:center;gap:14px;flex:none")}>
                      {st.avatar ? (
                        <img src={A(st.avatar)} alt={st.author} style={s("width:52px;height:52px;border-radius:99px;object-fit:cover;flex:none;border:2px solid #FDECEC")} />
                      ) : (
                        <span style={s("width:52px;height:52px;border-radius:99px;flex:none;background:#FDECEC;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:19px;color:#A41D2D")}>{st.initials}</span>
                      )}
                      <span style={s("display:flex;flex-direction:column;gap:2px;min-width:0")}>
                        <span style={s("font-size:16px;font-weight:600;color:#4A0000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{st.author}</span>
                        <span style={s("font-size:13px;color:#6B0505;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{st.profession}</span>
                      </span>
                    </div>

                    <div style={s("display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none")}>
                      <span style={s("display:flex;gap:3px")}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <svg key={n} width="15" height="15" viewBox="0 0 24 24" fill="var(--butter-ink)" stroke="none">
                            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
                          </svg>
                        ))}
                      </span>
                      <span style={s("padding:5px 12px;border-radius:99px;background:#FDECEC;font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#A41D2D")}>{st.tagLabel}</span>
                    </div>

                    <div style={s("width:100%;height:1px;background:#F3DADA;flex:none")} />

                    <p className="story-lead" style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(17px,1.4vw,20px);line-height:1.26;letter-spacing:-0.01em;color:#4A0000;flex:none")}>“{st.lead}”</p>
                    <p className="story-rest" style={s("margin:0;font-size:14px;line-height:1.55;color:#6B0505")}>{st.rest}</p>
                  </Hov>
                ))}
              </div>
            </div>

            <div style={s("max-width:1320px;width:100%;margin:0 auto;padding:0 34px;display:flex;align-items:center;gap:20px;flex-wrap:wrap")}>
              <Hov tag="a" href={IG_LINK} target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:11px;height:58px;padding:0 30px;border-radius:99px;background:#fff;color:#A41D2D;font-size:16px;font-weight:600;box-shadow:0 22px 44px -22px rgba(0,0,0,0.8);transition:transform .3s cubic-bezier(.22,.61,.36,1)" hover="transform:translateY(-3px)">
                La próxima historia puede ser la tuya
                <ArrowIcon />
              </Hov>
            </div>
          </div>
          </div>
        </section>

        <section id="acerca" style={s("background:#FFF5F5;padding:var(--sp-md) 34px")}>
          <div className="g-acerca" style={s("max-width:1320px;margin:0 auto;display:grid;position:relative")}>
            <div data-reveal="scale" className="about-col" style={s("display:flex;flex-direction:column;gap:22px")}>
              <div className="about-slot" style={s("margin-top:16px;display:flex;flex-direction:column;gap:12px")}>
                {/* El alto manda y el ancho se deriva del 9/16. Antes esto era
                    width:100% + max-height, y esa combinación achataba la caja
                    hasta volverla horizontal. */}
                <div className="about-video" style={s("position:relative;aspect-ratio:9/16;height:clamp(480px,72vh,700px);width:auto;max-width:100%;margin:0 auto;border-radius:26px;overflow:hidden;background:#2A0007;box-shadow:0 24px 54px -34px rgba(74,0,0,0.5)")}>
                  <iframe
                    src="https://www.youtube.com/embed/xiD8rFIB9J8?mute=1&loop=1&playlist=xiD8rFIB9J8&modestbranding=1&rel=0"
                    title="Presentación de Lourdes Populin"
                    style={s("position:absolute;inset:0;width:100%;height:100%;border:0")}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
            <div data-reveal="up" style={s("display:flex;flex-direction:column;gap:16px")}>
              <div style={s("align-self:flex-start;background:#fff;border-radius:20px;padding:11px 18px 11px 12px;box-shadow:0 30px 60px -26px rgba(74,0,0,0.5);display:flex;align-items:center;gap:13px")}>
                <img src={A("assets/lou-retrato.jpg")} alt="" style={s("width:48px;height:48px;border-radius:99px;object-fit:cover;flex-shrink:0")} />
                <div style={s("display:flex;flex-direction:column")}>
                  <span style={s("font-size:15px;font-weight:600;color:#A41D2D;white-space:nowrap")}>Lourdes Populin</span>
                  <span style={s("font-size:12.5px;color:#6B0505;white-space:nowrap")}>Profesora certificada · 200 h</span>
                </div>
              </div>
              <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#A41D2D")}>Sobre Lou</span>
              <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(28px,3.4vw,44px);line-height:1.06;letter-spacing:-0.03em;color:#4A0000")}>Sabiduría antigua, para tu bienestar de hoy.</h2>
              <p style={s("margin:0;font-size:16.5px;line-height:1.55;color:#6B0505;text-wrap:pretty")}>
                Soy Lourdes Populin, profesora de yoga certificada (200 h, Instituto Ananda Yoga, Buenos Aires). En 7 años de práctica e investigación combiné el Hatha Yoga y los <em>Yoga Sūtras de Patañjali</em> con neurociencia aplicada, anatomía, biomecánica, ayurveda y filosofía para armar un modelo de clase propio.
              </p>
              <p style={s("margin:0;font-size:16.5px;line-height:1.55;color:#6B0505;text-wrap:pretty")}>
                No te voy a pedir que llegues a una postura. Te voy a mostrar qué le pasa a tu cerebro cuando respirás distinto, y cómo usar eso el resto de la semana.
              </p>

              <div style={s("display:flex;flex-direction:column;gap:9px;padding:16px 20px;border-radius:18px;background:#fff;border:1px solid #F3DADA;box-shadow:0 20px 44px -32px rgba(74,0,0,0.45)")}>
                <span style={s("font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#A41D2D")}>Formación</span>
                <div style={s("display:flex;flex-direction:column;gap:7px")}>
                  {CREDENTIALS.map((c) => (
                    <div key={c.strong} style={s("display:flex;gap:12px;align-items:flex-start")}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A41D2D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s("flex-shrink:0;margin-top:3px")}>
                        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                        <path d="M6 12v5c3 3 9 3 12 0v-5" />
                      </svg>
                      <span style={s("font-size:15.5px;line-height:1.45;color:#4A0000")}>
                        <strong style={s("font-weight:600")}>{c.strong}</strong>
                        {c.rest}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="g-benefits" style={s("display:grid;gap:12px")}>
                {BENEFITS.map((b) => (
                  <div key={b.t} style={s("background:#fff;border-radius:14px;padding:14px 16px;border:1px solid #F3DADA;display:flex;flex-direction:column;gap:4px")}>
                    <span style={s("font-size:14.5px;font-weight:600;color:#A41D2D")}>{b.t}</span>
                    <span style={s("font-size:14px;line-height:1.5;color:#6B0505")}>{b.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="clases" style={s("background:#FDECEC;padding:var(--sp-lg) 34px")}>
          <div style={s("max-width:1320px;margin:0 auto")}>
            <div data-reveal="up" style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:48px;margin-bottom:48px;flex-wrap:wrap")}>
              <div style={s("display:flex;flex-direction:column;gap:16px;max-width:620px")}>
                <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#A41D2D")}>Clases y packs</span>
                <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(29px,3.6vw,46px);line-height:1.04;letter-spacing:-0.03em;color:#4A0000")}>Elegí el formato que te sostiene</h2>
              </div>
              <p style={s("margin:0;font-size:15.5px;line-height:1.55;color:#6B0505;max-width:310px")}>Los packs quedan habilitados 30 días y reservás cada clase cuando te acomode.</p>
            </div>

            <div data-reveal="stagger" className="g-clases" style={s("display:grid;gap:24px;align-items:stretch")}>
              {PLANS.map((p) => (
                <Hov
                  key={p.name}
                  css="border-radius:28px;padding:40px 34px;display:flex;flex-direction:column;gap:20px;transition:transform .4s cubic-bezier(.22,.61,.36,1),box-shadow .4s"
                  hover="transform:translateY(-8px);box-shadow:0 46px 80px -40px rgba(74,0,0,0.65)"
                  style={{ background: p.cardBg, border: `1px solid ${p.cardBorder}`, boxShadow: p.cardShadow }}
                >
                  <div style={s("display:flex;align-items:center;justify-content:space-between;gap:12px")}>
                    <h3 style={{ ...s("margin:0;font-size:20px;font-weight:600"), color: p.titleColor }}>{p.name}</h3>
                    {p.badge && (
                      <span style={{ ...s("font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:6px 13px;border-radius:99px"), background: p.badgeBg, color: p.badgeColor }}>{p.badge}</span>
                    )}
                  </div>
                  {SHOW_PRICES && (
                    <div style={s("display:flex;align-items:flex-end;gap:9px")}>
                      <span style={{ ...s("font-family:'Playfair Display',serif;font-size:clamp(32px,3.6vw,44px);line-height:1"), color: p.titleColor }}>{p.price}</span>
                      <span style={{ ...s("font-size:14px;padding-bottom:5px"), color: p.mutedColor }}>{p.unit}</span>
                    </div>
                  )}
                  <p style={{ ...s("margin:0;font-size:15px;line-height:1.55"), color: p.mutedColor }}>{p.desc}</p>
                  <div style={s("display:flex;flex-direction:column;gap:11px;flex:1")}>
                    {p.feats.map((f, i) => (
                      <div key={i} style={s("display:flex;gap:11px;align-items:flex-start")}>
                        <CheckIcon stroke={p.tickColor} size={13} style={s("flex-shrink:0;margin-top:5px")} />
                        <span style={{ ...s("font-size:15px;line-height:1.5"), color: p.bodyColor }}>{f.t}</span>
                      </div>
                    ))}
                  </div>
                  <Hov
                    tag="a"
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    css="display:inline-flex;align-items:center;justify-content:center;gap:9px;height:56px;padding:0 24px;border-radius:99px;font-size:15.5px;font-weight:600;transition:transform .3s cubic-bezier(.22,.61,.36,1)"
                    hover="transform:translateY(-3px)"
                    style={{ background: p.btnBg, color: p.btnColor, border: `1.5px solid ${p.btnBorder}` }}
                  >
                    {p.btn}
                  </Hov>
                </Hov>
              ))}
            </div>
          </div>
        </section>

        {/* Fondo #FFF8F8: #FDECEC choca con Clases (arriba) y #FFF5F5 con
            Contacto (abajo). Es el tono claro que ya usa el gradiente del hero. */}
        <section id="meditacion" style={s("background:#FFF8F8;padding:var(--sp-md) 34px")}>
          <div className="g-medit" style={s("max-width:1180px;margin:0 auto;display:grid;gap:56px")}>
            <div data-reveal="up" style={s("display:flex;flex-direction:column")}>
              {/* Eyebrow puramente tipográfico: sin punto ni cápsula, para que
                  lea como categoría editorial y no como badge. */}
              <span className="medit-eyebrow" style={s("font-size:11px;font-weight:700;letter-spacing:0.26em;text-transform:uppercase;color:#A41D2D")}>Meditación</span>

              {/* El max-width fuerza un corte de dos líneas deliberado en vez de
                  dejarlo al azar del ancho de columna. */}
              <h2 className="medit-title" style={s("margin:10px 0 0;font-family:'Playfair Display',serif;font-size:clamp(29px,2.9vw,40px);line-height:1.05;letter-spacing:-0.032em;color:#4A0000;max-width:11.5em")}>
                ¿Querés aprender a <span style={s("color:var(--fucsia)")}>meditar</span>?
              </h2>

              {/* Puente entre título y cuerpo: peso normal y menor escala para
                  que no funcione como segundo titular. */}
              <p className="medit-sub" style={s("margin:18px 0 0;font-size:17px;line-height:1.5;color:#5C2130;max-width:34em;font-weight:400;text-wrap:pretty")}>
                <span style={s("background:linear-gradient(180deg,rgba(234,217,154,0) 63%,var(--butter-soft) 63%);box-decoration-break:clone;-webkit-box-decoration-break:clone")}>Meditación para mentes curiosas</span>, a las que les gusta entender el porqué y el cómo de las cosas.
              </p>

              {/* 64em de ancho de lectura: líneas más largas significan menos
                  líneas totales, que es de dónde sale la altura que sobraba. */}
              <div className="medit-body" style={s("display:flex;flex-direction:column;gap:13px;margin-top:20px;max-width:64ch")}>
                <p style={s("margin:0;font-size:16px;line-height:1.55;color:#6B0505;text-wrap:pretty")}>
                  Para algunas personas, meditar tiene más que ver con entrenar la atención. Para otras, con aprender a observar pensamientos, emociones y sensaciones sin juzgarlos ni quedar atrapadas en ellos. Y ninguna de las dos formas está equivocada.
                </p>
                <p style={s("margin:0;font-size:16px;line-height:1.55;color:#6B0505;text-wrap:pretty")}>
                  Existen muchísimas prácticas y maneras de meditar. Por eso, la idea no es enseñarte una única técnica, sino charlar, entender qué buscás y practicar diferentes formas hasta encontrar la que más se asocie con vos.
                </p>
                <p style={s("margin:0;font-size:16px;line-height:1.55;color:#6B0505;text-wrap:pretty")}>
                  Ya sea que quieras entrenar tu atención, mejorar tu concentración, trabajar la memoria, sentir mayor calma o simplemente aprender a relacionarte de otra manera con lo que pasa en tu mente, vamos a construir una práctica que tenga sentido para vos.
                </p>
              </div>

              <div className="medit-cta" style={s("display:flex;flex-direction:column;align-items:flex-start;gap:11px;margin-top:26px")}>
                {/* Badge, no botón: no compite con el CTA porque no es clickeable
                    ni usa el bordó lleno. */}
                {/* Manteca de fondo + bordó de texto: el momento más claro del
                    nuevo amarillo. El punto fucsia lo ata al resto de la sección. */}
                <span className="medit-badge" style={s("display:inline-flex;align-items:center;padding:5px 10px;border-radius:var(--r-sm);background:var(--butter-wash);border:1px solid rgba(210,181,101,0.5);color:#8B1A28;font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;white-space:nowrap")}>
                  20% OFF
                </span>

                <Hov
                  tag="a"
                  href={IG_MEDIT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="medit-btn"
                  css="display:inline-flex;align-items:center;justify-content:center;gap:14px;height:44px;padding:0 22px;border-radius:var(--r-md);background:#7C1526;color:#FFF9F5;font-size:14px;font-weight:500;letter-spacing:0.01em;cursor:pointer;transition:background .24s ease,box-shadow .24s ease"
                  hover="background:#6A1120;box-shadow:0 4px 14px -8px rgba(74,0,0,0.45)"
                >
                  Quiero recibir más información
                  {/* Flecha manteca: el detalle que evita repetir el amarillo
                      del badge y a la vez los emparenta. */}
                  <span className="medit-arrow" style={s("display:inline-flex;color:var(--butter);transition:transform .24s cubic-bezier(.22,.61,.36,1)")}>
                    <ArrowIcon size={14} />
                  </span>
                </Hov>
              </div>
            </div>

            {/* La altura la fija el contenedor y la imagen lo llena. Con
                aspect-ratio 4/5 la foto medía 800px de alto y era lo que
                empujaba la sección más allá de una pantalla. */}
            {/* La foto se estira a la altura exacta de la columna de texto:
                bordes superior e inferior alineados, para que lean como una
                sola composición y no como una tarjeta al costado. */}
            <div data-reveal="scale" className="medit-media" style={s("position:relative;display:flex")}>
              <div className="medit-frame" style={s("position:relative;flex:1;border-radius:var(--r-lg);overflow:hidden;background:#E8DFD2;box-shadow:0 18px 40px -30px rgba(74,0,0,0.4)")}>
                <img
                  className="medit-img"
                  src={A("assets/meditacion-rio.png")}
                  alt="Práctica de yoga junto al río al atardecer"
                  loading="lazy"
                  style={s("width:100%;height:100%;object-fit:cover;object-position:58% 50%;display:block")}
                />
              </div>
            </div>
          </div>

          {/* Espacio reservado para el bloque bordó del programa de tres semanas.
              Sin contenido todavía: se define más adelante. */}
        </section>

        <section id="contacto" style={s("position:relative;overflow:hidden;background:#FFF5F5;padding:var(--sp-lg) 26px")}>
          <div data-reveal="up" style={s("position:relative;max-width:1320px;margin:0 auto;border-radius:38px;overflow:hidden;background:linear-gradient(135deg,#A41D2D 0%,#8B1A28 58%,#6B0505 100%);box-shadow:0 60px 110px -60px rgba(74,0,0,0.95)")}>
            <div style={s("position:absolute;inset:0;background:radial-gradient(ellipse 46% 68% at 22% 12%, rgba(255,255,255,0.2), transparent 65%)")} />
            <div ref={ctaFloatRef} style={s("position:absolute;right:-90px;top:-70px;width:380px;height:380px;border-radius:99px;background:radial-gradient(circle at 38% 34%, rgba(255,214,234,0.42), rgba(255,142,190,0.05) 68%);filter:blur(4px);will-change:transform")} />

            <div className="g-contacto" style={s("position:relative;padding:96px 70px;display:grid;gap:60px;align-items:center")}>
              <div style={s("display:flex;flex-direction:column;gap:26px")}>
                <span style={s("display:inline-flex;align-self:flex-start;align-items:center;gap:10px;padding:9px 18px;border-radius:99px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.26);backdrop-filter:blur(10px);font-size:11.5px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#fff")}>
                  <span style={s("width:7px;height:7px;border-radius:99px;background:#FF8EBE")} />
                  Agenda abierta
                </span>
                <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(34px,4.8vw,60px);line-height:0.98;letter-spacing:-0.035em;color:#fff;text-wrap:balance")}>Empezá esta semana</h2>
                <p style={s("margin:0;font-size:19.5px;line-height:1.55;color:rgba(255,255,255,0.82);max-width:520px")}>Un mensaje y coordinamos. Te propongo día, horario y un plan pensado para tu cuerpo y tu semana real.</p>
                <div style={s("display:flex;flex-wrap:wrap;gap:13px;padding-top:6px")}>
                  <Hov tag="a" href={IG_LINK} target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:11px;height:58px;padding:0 32px;border-radius:99px;background:#FCE7EC;color:#8B1A28;font-size:16.5px;font-weight:700;border:1px solid rgba(164,29,45,0.18);box-shadow:0 10px 26px -14px rgba(0,0,0,0.4);transition:transform .26s cubic-bezier(.22,.61,.36,1),box-shadow .26s,background .26s" hover="transform:translateY(-2px);background:#FBDCE4;box-shadow:0 16px 32px -16px rgba(0,0,0,0.45)">
                    <IgIcon size={19} />
                    Escribime por Instagram
                  </Hov>
                  <Hov tag="a" href={MAIL_LINK} css="display:inline-flex;align-items:center;gap:11px;height:58px;padding:0 28px;border-radius:99px;background:transparent;border:1.5px solid rgba(255,255,255,0.5);color:#fff;font-size:16.5px;font-weight:600;transition:background .3s,border-color .3s" hover="background:rgba(255,255,255,0.14);border-color:#fff">
                    <MailIcon size={18} />
                    Escribime por email
                  </Hov>
                </div>
                <span style={s("font-size:14.5px;color:rgba(255,255,255,0.6)")}>Respondo en el día · Online y presencial · Sin compromiso</span>
              </div>

              <div style={s("display:flex;flex-direction:column;gap:14px")}>
                {CTA_ASSURANCE.map((a) => (
                  <div key={a.n} style={s("display:flex;gap:16px;align-items:flex-start;padding:22px 24px;border-radius:20px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);backdrop-filter:blur(8px)")}>
                    <span style={s("flex-shrink:0;font-family:'Playfair Display',serif;font-size:20px;color:var(--butter)")}>{a.n}</span>
                    <span style={s("display:flex;flex-direction:column;gap:4px")}>
                      <span style={s("font-size:15.5px;font-weight:600;color:#fff")}>{a.t}</span>
                      <span style={s("font-size:14px;line-height:1.5;color:rgba(255,255,255,0.68)")}>{a.d}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="faq" style={s("background:#FDECEC;padding:var(--sp-lg) 34px")}>
          <div className="g-faq" style={s("max-width:1320px;margin:0 auto;display:grid;gap:70px;align-items:start")}>
            <div data-reveal="up" style={s("display:flex;flex-direction:column;gap:18px;position:sticky;top:130px")}>
              <img src={A("assets/lou-retrato.jpg")} alt="Lourdes Populin" style={s("width:68px;height:68px;border-radius:99px;object-fit:cover;box-shadow:0 16px 32px -14px rgba(74,0,0,0.6)")} />
              <span style={s("font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#A41D2D")}>Dudas</span>
              <h2 style={s("margin:0;font-family:'Playfair Display',serif;font-size:clamp(28px,3.3vw,42px);line-height:1.04;letter-spacing:-0.03em;color:#4A0000")}>Preguntas frecuentes</h2>
              <p style={s("margin:0;font-size:16.5px;line-height:1.55;color:#6B0505")}>¿Quedó algo afuera? Escribime y te contesto en el día.</p>
              <Hov tag="a" href={MAIL_LINK} css="display:inline-flex;align-items:center;gap:10px;height:52px;padding:0 24px;border-radius:99px;background:#fff;border:1px solid rgba(164,29,45,0.18);color:#A41D2D;font-size:15px;font-weight:600;align-self:flex-start;transition:transform .3s cubic-bezier(.22,.61,.36,1),box-shadow .3s" hover="transform:translateY(-3px);box-shadow:0 16px 32px -18px rgba(74,0,0,0.5)">
                <MailIcon />
                Hacer una pregunta
              </Hov>
            </div>
            <div data-reveal="up" style={s("display:flex;flex-direction:column;background:#fff;border-radius:28px;border:1px solid #F3DADA;overflow:hidden;box-shadow:0 30px 64px -44px rgba(74,0,0,0.55)")}>
              {FAQS.map((f, n) => (
                <div
                  key={f.q}
                  style={{
                    ...s("border-bottom:1px solid #F7E6E6;transition:background .25s"),
                    // Abierto: lavado manteca casi imperceptible que marca
                    // cuál es la pregunta activa.
                    ...(openFaq === n ? { background: "var(--butter-wash)" } : {}),
                  }}
                >
                  <Hov
                    tag="button"
                    onClick={() => setOpenFaq(openFaq === n ? null : n)}
                    css="display:flex;width:100%;align-items:center;justify-content:space-between;gap:18px;padding:27px 34px;text-align:left;font-size:17.5px;font-weight:600;color:#4A0000;background:transparent;border:0;cursor:pointer;font-family:inherit;transition:color .25s"
                    hover="color:#A41D2D"
                  >
                    <span>{f.q}</span>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--fucsia)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "transform .35s cubic-bezier(.22,.61,.36,1)", transform: openFaq === n ? "rotate(180deg)" : "rotate(0deg)" }}>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </Hov>
                  {openFaq === n && <div style={s("padding:0 34px 28px;font-size:16px;line-height:1.68;color:#6B0505;max-width:680px")}>{f.a}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        </main>

        <footer style={s("background:#4A0000;padding:66px 34px 42px")}>
          <div style={s("max-width:1320px;margin:0 auto;display:flex;flex-direction:column;gap:40px")}>
            <div className="g-footer" style={s("display:grid;gap:60px;align-items:end")}>
              <div style={s("display:flex;flex-direction:column;gap:18px")}>
                <div style={s("display:flex;align-items:center;gap:12px")}>
                  <img src={A("assets/ginkgo.png")} alt="" style={s("width:30px;height:30px;filter:brightness(0) invert(1)")} />
                  <span style={s("font-family:'Playfair Display',serif;font-size:24px;color:#fff")}>Yoga ByLou</span>
                </div>
                <p style={s("margin:0;font-family:'Playfair Display',serif;font-size:34px;line-height:1.14;letter-spacing:-0.02em;color:#fff;max-width:480px")}>Tu sistema nervioso también aprende.</p>
              </div>
              <div style={s("display:flex;flex-direction:column;gap:14px;align-items:flex-start")}>
                <Hov tag="a" href={IG_LINK} target="_blank" rel="noopener noreferrer" css="display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 28px;border-radius:99px;background:#fff;color:#A41D2D;font-size:15.5px;font-weight:600;transition:transform .3s cubic-bezier(.22,.61,.36,1)" hover="transform:translateY(-3px)">
                  Reservar clase de prueba
                  <ArrowIcon size={16} />
                </Hov>
                <div style={s("display:flex;flex-wrap:wrap;gap:20px;font-size:14.5px")}>
                  <Hov tag="a" href={`mailto:${EMAIL}`} css="color:rgba(255,255,255,0.75)" hover="color:#fff">
                    {EMAIL}
                  </Hov>
                  <Hov tag="a" href="https://www.instagram.com/bylou.yoga" target="_blank" rel="noopener noreferrer" css="color:rgba(255,255,255,0.75)" hover="color:#fff">
                    @bylou.yoga
                  </Hov>
                </div>
              </div>
            </div>
            <div style={s("border-top:1px solid rgba(255,255,255,0.14);padding-top:24px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;font-size:13.5px;color:rgba(255,255,255,0.45)")}>
              <span>© 2026 ByLou Yoga</span>
              <span>Online y presencial · Buenos Aires</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
