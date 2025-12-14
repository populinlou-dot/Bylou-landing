"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Instagram, Mail, ChevronLeft, ChevronRight, Quote } from "lucide-react"

export default function YogaLanding() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const autoplayIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false)
  const [guideName, setGuideName] = useState("")
  const [guideEmail, setGuideEmail] = useState("")
  const [cardsPerView, setCardsPerView] = useState(1)

  const instagramLink = "https://instagram.com/bylou.yoga"
  const emailAddress = "yoga.byloupopulin@gmail.com"

  const testimonials = [
    {
      text: "Las clases son súper personalizadas, adaptadas tanto a mis objetivos como a mi flexibilidad y estado de ánimo. Muy interesante la conexión de la neurociencia con los movimientos, posturas y elongaciones! MUY recomendado 💪🏼❤️",
      author: "Santiago G.",
      profession: "Profesor de Educacion Fisica",
    },
    {
      text: "La verdad que las clases fueron super lindas, uno se siente libre, en un espacio de reflexión y paz ♡ Toda la info que transmitió fue super útil. Una profe muy sabia",
      author: "Ana D.",
      profession: "Estudiante de Psicología",
    },
    {
      text: "Quiero agradecerte de corazón por todo lo que transmitís en cada clase. Sos una profesora realmente especial: se nota tu preparación, tu amor por lo que hacés y la paz que irradiás. Gracias por acompañar con tanta paciencia, por enseñar desde el alma y por recordarme, la importancia de respirar, soltar y conectar. Practicar yoga con vos es un verdadero regalo del universo.💫",
      author: "Delia C.",
      profession: "Docente",
    },
    {
      text: "Las clases de Lou son épicas y en mi caso personalizadas, en ellas se puede fluir muy bien las ideas que trae a la práctica con los objetivos y capacidades de uno. Si bien los asanas son los mismos hace milenios, cada clase con ella es única. Muchas gracias 😊.",
      author: "Ezequiel D.",
      profession: "Politólogo",
    },
    {
      text: "Hice yoga antes y no encontraba algo dinámico y con esfuerzo físico real como en las clases de Luchi. Se adaptan al alumno, encontrando el equilibrio entre entrenamiento, presencia y su sabiduría inmensa <3 100 puntos!!!",
      author: "Lucas B.",
      profession: "Estudiante de Ingeniería",
    },
    {
      text: "Hacer yoga es como una caricia al cuerpo y a la mente, Lourdes lo lleva a otro nivel.",
      author: "Damian P.",
      profession: "IT Project Manager",
    },
    {
      text: "Tomar clases con Luchi ha sido una experiencia hermosa. Siempre ha sido muy atenta y amable, y se nota que pone el corazón en cada clase. Me han ayudado muchísimo, tanto para mejorar mi postura como para aliviar la ansiedad. Disfruto mucho poder incluir estas clases como parte de mi proceso personal; realmente marcan una diferencia. 🌿🫀💫",
      author: "Roxana S.",
      profession: "Direc. Creativa Publicitaria",
    },
  ]

  const infiniteTestimonials = [...testimonials, ...testimonials, ...testimonials]
  const totalSlides = testimonials.length

  useEffect(() => {
    const updateCardsPerView = () => {
      if (window.innerWidth >= 1024) {
        setCardsPerView(3)
      } else if (window.innerWidth >= 768) {
        setCardsPerView(2)
      } else {
        setCardsPerView(1)
      }
    }

    updateCardsPerView()
    window.addEventListener("resize", updateCardsPerView)
    return () => window.removeEventListener("resize", updateCardsPerView)
  }, [])

  useEffect(() => {
    const startAutoplay = () => {
      autoplayIntervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => prev + 1)
      }, 5000)
    }
    startAutoplay()
    return () => {
      if (autoplayIntervalRef.current) clearInterval(autoplayIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (currentIndex >= totalSlides * 2) {
      setTimeout(() => setCurrentIndex(totalSlides), 500)
    } else if (currentIndex < totalSlides) {
      setTimeout(() => setCurrentIndex(totalSlides), 0)
    }
  }, [currentIndex, totalSlides])

  const resetAutoplay = () => {
    if (autoplayIntervalRef.current) clearInterval(autoplayIntervalRef.current)
    autoplayIntervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => prev + 1)
    }, 5000)
  }

  const goToSlide = (index: number) => {
    setCurrentIndex(totalSlides + index)
    resetAutoplay()
  }

  const nextSlide = () => {
    setCurrentIndex((prev) => prev + 1)
    resetAutoplay()
  }

  const prevSlide = () => {
    setCurrentIndex((prev) => prev - 1)
    resetAutoplay()
  }

  function handleContactSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)

    const name = String(fd.get("name") || "").trim()
    const email = String(fd.get("email") || "").trim()
    const message = String(fd.get("message") || "").trim()

    const subject = `Consulta desde la web — ${name || "Sin nombre"}`
    const body =
      `Nombre: ${name}\n` +
      `Email: ${email}\n\n` +
      `Mensaje:\n${message}`

    const MAX = 1800
    const safeBody = body.length > MAX ? body.slice(0, MAX) + "\n\n[Mensaje truncado]" : body

    const params = new URLSearchParams({
      to: emailAddress,
      su: subject,
      body: safeBody,
    })

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`

    window.open(gmailUrl, "_blank")
  }

  function handleGuideSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const subject = "Solicitud de Guía Anti-Estrés"
    const body = `Nombre: ${guideName}\nEmail: ${guideEmail}\n\nPor favor enviar la guía anti-estrés en PDF.`

    window.location.href = `mailto:${emailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      body,
    )}`

    setIsGuideModalOpen(false)
    setGuideName("")
    setGuideEmail("")
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FDECEC" }}>
      {/* HEADER */}
      <header
        className="sticky top-0 z-50 backdrop-blur border-b"
        style={{ backgroundColor: "rgba(253, 236, 236, 0.95)", borderColor: "#E8C5C5" }}
      >
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/images/design-mode/ginkgo_transparent_bg.png"
                alt="ByLou Yoga Logo"
                className="w-8 h-8 md:w-10 md:h-10"
              />
              <div className="text-2xl font-bold" style={{ color: "#A41D2D" }}>
                Yoga ByLou
              </div>
            </div>

            <div className="hidden md:flex items-center space-x-8">
              {[
                { href: "#inicio", label: "Inicio" },
                { href: "#acerca", label: "Acerca de mí" },
                { href: "#servicios", label: "Servicios" },
                { href: "#opiniones", label: "Opiniones" },
                { href: "#faq", label: "FAQ" },
                { href: "#contacto", label: "Contacto" },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="transition-colors"
                  style={{ color: "#4A0000" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#A41D2D")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#4A0000")}
                >
                  {item.label}
                </a>
              ))}
            </div>

            <Button asChild className="hidden md:flex" style={{ backgroundColor: "#A41D2D", color: "white" }}>
              <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                <Instagram className="w-4 h-4 mr-2" />
                Enviar mensaje
              </a>
            </Button>

            <button className="md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              <div className="w-6 h-6 flex flex-col justify-center items-center">
                <span
                  className={`block transition-all duration-300 ease-out h-0.5 w-6 rounded-sm ${
                    isMenuOpen ? "rotate-45 translate-y-1" : "-translate-y-0.5"
                  }`}
                  style={{ backgroundColor: "#A41D2D" }}
                />
                <span
                  className={`block transition-all duration-300 ease-out h-0.5 w-6 rounded-sm my-0.5 ${
                    isMenuOpen ? "opacity-0" : "opacity-100"
                  }`}
                  style={{ backgroundColor: "#A41D2D" }}
                />
                <span
                  className={`block transition-all duration-300 ease-out h-0.5 w-6 rounded-sm ${
                    isMenuOpen ? "-rotate-45 -translate-y-1" : "translate-y-0.5"
                  }`}
                  style={{ backgroundColor: "#A41D2D" }}
                />
              </div>
            </button>
          </nav>

          {isMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t" style={{ borderColor: "#E8C5C5" }}>
              <div className="flex flex-col space-y-4 pt-4">
                {[
                  { href: "#inicio", label: "Inicio" },
                  { href: "#acerca", label: "Acerca de mí" },
                  { href: "#servicios", label: "Servicios" },
                  { href: "#opiniones", label: "Opiniones" },
                  { href: "#faq", label: "FAQ" },
                  { href: "#contacto", label: "Contacto" },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="transition-colors"
                    style={{ color: "#4A0000" }}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
                <Button asChild className="w-full" style={{ backgroundColor: "#A41D2D", color: "white" }}>
                  <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                    <Instagram className="w-5 h-5 mr-2" />
                    Enviar mensaje
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* HERO */}
      <section id="inicio" className="w-full hero-bg">
        <div className="mx-auto max-w-7xl px-4 py-4 md:py-6 grid md:grid-cols-2 gap-8 md:gap-16 items-center">
          <div className="space-y-6 flex flex-col leading-7 tracking-widest text-xl items-center justify-start md:ml-10 lg:ml-16">
            <h1
              className="font-serif text-5xl md:text-6xl leading-tight text-center lg:text-6xl"
              style={{
                color: "#4A0000",
                fontFamily: '"Playfair Display", ui-serif, Georgia, "Times New Roman", serif',
              }}
            >
              Regulá tu
              <br />
              <span
                className="italic text-primary"
                style={{ color: "#A41D2D" }}
              >
                sistema nervioso
              </span>
            </h1>

            <p
              className="text-base md:text-lg leading-relaxed max-w-xl font-sans text-center"
              style={{ color: "#4A0000" }}
            >
              Clases de yoga, con base científica para habitarte en calma: entendé tu cerebro y regulá tu sistema
              nervioso con neurociencia práctica
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-4 justify-center">
              <Button
                size="lg"
                asChild
                className="text-lg px-8 py-6 rounded-full shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                  color: "white",
                  border: "none",
                }}
              >
                <a
                  href="https://ig.me/m/bylou.yoga?text=Hola!%20Me%20gustar%C3%ADa%20probar%20una%20clase%20%F0%9F%8C%B8"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Quiero mi plan personal"
                >
                  Quiero mi plan personal
                </a>
              </Button>
            </div>
          </div>

          <div className="flex flex-col items-center md:items-end">
            <div className="w-full max-w-sm">
              <iframe
                src="https://www.youtube.com/embed/xiD8rFIB9J8?autoplay=1&mute=1&loop=1&playlist=xiD8rFIB9J8&controls=1&modestbranding=1&rel=0"
                className="w-full rounded-2xl shadow-lg"
                style={{ aspectRatio: "9/16", height: "600px", boxShadow: "0 10px 25px rgba(164, 29, 45, 0.2)" }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Video de introducción de Lourdes Populin"
              />
            </div>
            <div className="mt-4 text-center md:text-left">
              <p className="text-sm font-semibold" style={{ color: "#A41D2D" }}>
                Lourdes Populin
              </p>
              <p className="text-xs leading-snug" style={{ color: "#6B0505" }}>
                Profesora de Yoga certificada
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ACERCA DE MÍ */}
      <section id="acerca" className="w-full border-t" style={{ backgroundColor: "#FDECEC", borderColor: "#E8C5C5" }}>
        <div className="mx-auto max-w-5xl px-4 md:px-6 lg:px-8 py-12 md:py-16">
          <div className="flex items-center justify-center gap-3 mb-12">
            <img src="/images/design-mode/ginkgo_transparent_bg.png" alt="" className="w-8 h-8 md:w-10 md:h-10" />
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ color: "#A41D2D" }}>
              Acerca de mí
            </h2>
          </div>

          <div className="grid md:grid-cols-[1.1fr_1.4fr] gap-8 md:gap-12 items-center">
            {/* Columna imagen */}
            <div className="flex justify-center md:justify-start">
              <div className="relative w-full max-w-sm">
                <div
                  className="absolute -inset-4 rounded-[32px] opacity-70 blur-xl"
                  style={{
                    background: "radial-gradient(circle at 30% 0%, rgba(255, 214, 234, 0.9), rgba(253, 236, 236, 0))",
                  }}
                  aria-hidden="true"
                />
                <img
                  src="/images/design-mode/2F534545-EBF7-4E29-A744-B3D450B87186.jpg"
                  alt="Lourdes Populin practicando yoga"
                  className="relative w-full rounded-3xl shadow-xl object-cover"
                  style={{
                    boxShadow: "0 20px 40px rgba(164, 29, 45, 0.25)",
                    border: "1px solid rgba(164, 29, 45, 0.15)",
                  }}
                />
              </div>
            </div>

            {/* Columna texto */}
            <div
              className="space-y-6 bg-white/70 rounded-3xl shadow-[0_18px_40px_rgba(164,29,45,0.12)] p-6 md:p-8"
              style={{ color: "#4A0000", fontSize: "16px", lineHeight: "1.6" }}
            >
              <p className="text-base md:text-lg">
                Hola:)
                <br />
                Soy Lourdes Populin, <em>profesora de yoga certificada</em> (200 h – Instituto Ananda Yoga, Buenos
                Aires).
              </p>

              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-[0.22em] uppercase" style={{ color: "#A41D2D" }}>
                  Formación & enfoque
                </p>
                <p className="text-base md:text-lg leading-relaxed">
                  A lo largo de mis <strong>7 años de práctica e investigación activa</strong>, combiné el <em>yoga</em>{" "}
                  con <strong>neurociencia aplicada</strong> para crear un <em>modelo de clase único</em>. Mi objetivo es{" "}
                  <strong>guiarte a conectar</strong> con una versión más <em>consciente, regulada y eficiente</em> de
                  vos mismo.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-[0.22em] uppercase" style={{ color: "#A41D2D" }}>
                  En qué te voy a ayudar
                </p>
                <ul className="list-none space-y-1 text-base md:text-lg leading-relaxed">
                  <li>• <strong>Regular tu sistema nervioso</strong> y salir del piloto automático.</li>
                  <li>• Usar la <strong>respiración consciente</strong> para bajar ansiedad y tensión física.</li>
                  <li>• Desarrollar una <strong>atención más clara</strong> para tomar mejores decisiones.</li>
                </ul>
              </div>

              <p className="text-base md:text-lg leading-relaxed">
                Mi práctica se basa en el <strong>Hatha Yoga</strong> y los <em>Yoga Sūtras de Patañjali</em>,
                complementada con <strong>anatomía</strong>, <em>biomecánica</em>, <em>ayurveda</em>,{" "}
                <strong>psicología</strong> y <strong>filosofía</strong>, siempre con un <em>enfoque cálido</em>,
                adaptando cada clase a tu <strong>bienestar físico, mental y emocional</strong>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section
        id="servicios"
        className="w-full border-t"
        style={{ backgroundColor: "#FFF5F5", borderColor: "#E8C5C5" }}
      >
        <div className="mx-auto max-w-7xl px-4 py-12 md:py-16">
          <div className="flex items-center justify-center gap-3 mb-10">
            <img
              src="/images/design-mode/ginkgo_transparent_bg.png"
              alt=""
              className="w-8 h-8 md:w-10 md:h-10"
            />
            <h2 className="text-3xl md:text-4xl font-bold" style={{ color: "#A41D2D" }}>
              Tipos de clases
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* 1:1 */}
            <div
              className="rounded-2xl bg-white shadow-lg p-6 flex flex-col justify-between transition-transform duration-300 hover:-translate-y-2 hover:shadow-xl"
              style={{ border: "1px solid #E8C5C5", boxShadow: "0 10px 25px rgba(164, 29, 45, 0.1)" }}
            >
              <h3 className="text-lg md:text-xl font-semibold mb-3" style={{ color: "#A41D2D" }}>
                1:1 Personalizado
              </h3>
              <ul className="text-sm leading-relaxed space-y-2 mb-4" style={{ color: "#4A0000" }}>
                <li>• Liberar tensión física específica</li>
                <li>• Rutina pensada para TU día real</li>
                <li>• Acompañamiento cercano y amable</li>
              </ul>
              <Button
                asChild
                className="self-start rounded-full px-6 py-3 text-sm font-semibold shadow-md transition-all"
                style={{
                  background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                  color: "white",
                  border: "none",
                }}
              >
                <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                  Obtener propuesta
                </a>
              </Button>
            </div>

            {/* Empresas */}
            <div
  className="rounded-2xl shadow-lg p-6 flex flex-col justify-between bg-white relative overflow-hidden transition-transform duration-300 hover:-translate-y-2 hover:shadow-xl"
  style={{
    border: "1px solid #E8C5C5",
    boxShadow: "0 10px 25px rgba(164, 29, 45, 0.1)",
    background:
      "radial-gradient(circle at 20% 20%, rgba(164, 29, 45, 0.08) 0%, rgba(255,255,255,0) 70%)",
  }}
>
  <h3 className="text-lg md:text-xl font-semibold mb-3" style={{ color: "#A41D2D" }}>
    Pausas activas / Yoga para empresas
  </h3>
  <ul className="text-sm leading-relaxed space-y-2 mb-4" style={{ color: "#4A0000" }}>
    <li>• Bajamos el estrés del equipo en 10 minutos</li>
    <li>• Respiración y foco para reuniones sin ansiedad</li>
    <li>• Menos dolor cervical y lumbar en oficina</li>
  </ul>

  <Button
    asChild
    className="self-start rounded-full px-6 py-3 text-sm font-semibold shadow-md transition-all"
    style={{
      background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
      color: "white",
      border: "none",
    }}
  >
    {/* Al hacer click baja hasta la sección de contacto */}
    <a href="#contacto">
      Obtener propuesta
    </a>
  </Button>
</div>
            {/* Grupales */}
            <div
              className="rounded-2xl bg-white shadow-lg p-6 flex flex-col justify-between transition-transform duration-300 hover:-translate-y-2 hover:shadow-xl"
              style={{ border: "1px solid #E8C5C5", boxShadow: "0 10px 25px rgba(164, 29, 45, 0.1)" }}
            >
              <h3 className="text-lg md:text-xl font-semibold mb-3" style={{ color: "#A41D2D" }}>
                Clases Grupales Online / En Vivo
              </h3>
              <ul className="text-sm leading-relaxed space-y-2 mb-4" style={{ color: "#4A0000" }}>
                <li>• Espacio seguro para bajar revoluciones</li>
                <li>• Prácticas accesibles, sin exigencia estética</li>
                <li>• Respiración guiada para calmar el sistema nervioso</li>
              </ul>
              <Button
                asChild
                className="self-start rounded-full px-6 py-3 text-sm font-semibold shadow-md transition-all"
                style={{
                  background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                  color: "white",
                  border: "none",
                }}
              >
                <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                  Obtener propuesta
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* OPINIONES */}
      <section
        id="opiniones"
        className="py-12 md:py-20 pb-6"
        style={{
          background:
            "radial-gradient(ellipse 32% 55% at 50% 32%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%), linear-gradient(to bottom, #A41D2D, #8B1A28)",
        }}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-3 mb-3 md:mb-4">
            <img
              src="/images/design-mode/ginkgo_transparent_bg.png"
              alt=""
              className="w-7 h-7 md:w-10 md:h-10 brightness-0 invert"
            />
            <h2 className="text-2xl md:text-4xl font-bold text-white text-center">
              Opiniones de alumnos
            </h2>
          </div>

          <p
            className="text-center text-sm md:text-base mb-8 md:mb-12 max-w-3xl mx-auto"
            style={{ color: "#FFE6E6" }}
          >
            Experiencias reales de quienes ya integran el yoga y la neurociencia en su
            vida cotidiana.
          </p>

          <div className="relative max-w-5xl lg:max-w-6xl mx-auto pb-12 md:pb-14">
            <div className="overflow-hidden px-2 sm:px-4">
              <div
                ref={carouselRef}
                className="flex transition-transform duration-500 ease-in-out"
                style={{
                  transform: `translateX(-${(currentIndex * 100) / cardsPerView}%)`,
                }}
              >
                {infiniteTestimonials.map((testimonial, index) => (
                  <div
                    key={index}
                    className="flex-shrink-0 px-2"
                    style={{ width: `${100 / cardsPerView}%` }}
                  >
                    <div className="bg-white rounded-3xl shadow-2xl px-6 py-6 md:px-8 md:py-8 flex flex-col h-full">
                      <p
                        className="text-sm md:text-base leading-relaxed flex-grow mb-4 md:mb-6 text-center"
                        style={{ color: "#4A0000", lineHeight: "1.6" }}
                      >
                        {testimonial.text}
                      </p>

                      <div
                        className="text-center border-t pt-3 md:pt-4"
                        style={{ borderColor: "#E8C5C5" }}
                      >
                        <p className="font-semibold text-base" style={{ color: "#A41D2D" }}>
                          {testimonial.author}
                        </p>
                        {testimonial.profession && (
                          <p className="text-sm mt-1" style={{ color: "#6B0505" }}>
                            {testimonial.profession}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Flechas */}
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                onClick={prevSlide}
                className="bg-white rounded-full p-4 shadow-lg hover:bg-[#FDECEC] transition-all hover:scale-110"
                style={{ border: "2px solid #A41D2D" }}
                aria-label="Anterior"
              >
                <ChevronLeft className="w-6 h-6" style={{ color: "#A41D2D" }} />
              </button>

              <button
                onClick={nextSlide}
                className="bg-white rounded-full p-4 shadow-lg hover:bg-[#FDECEC] transition-all hover:scale-110"
                style={{ border: "2px solid #A41D2D" }}
                aria-label="Siguiente"
              >
                <ChevronRight className="w-6 h-6" style={{ color: "#A41D2D" }} />
              </button>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-2 mt-4">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToSlide(index)}
                  className={`h-2 rounded-full transition-all ${
                    currentIndex % totalSlides === index ? "w-8 bg-white" : "w-2"
                  }`}
                  style={{
                    backgroundColor:
                      currentIndex % totalSlides === index ? "white" : "#E8C5C5",
                  }}
                  aria-label={`Ir a opinión ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* GUÍA PDF */}
      <section className="py-10 md:py-14" style={{ background: "linear-gradient(to bottom, #A41D2D, #8B1A28)" }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div
              className="rounded-3xl p-8 md:p-12 shadow-lg"
              style={{
                background: "linear-gradient(90deg, #FFE9F4 0%, #FFDDEE 35%, #FFC3DE 100%)",
                boxShadow: "0 18px 40px rgba(255, 143, 187, 0.4)",
                border: "none",
              }}
            >
              <div className="grid md:grid-cols-[3fr_2fr] gap-8 items-center">
                <div className="space-y-4">
                  <h2 className="text-2xl md:text-3xl font-bold leading-tight" style={{ color: "#5A0015" }}>
                    Tu primera guía de Yoga y Neurociencia, gratis en PDF
                  </h2>
                  <p className="text-base md:text-lg leading-relaxed" style={{ color: "#6B0505" }}>
                    Aprendé cómo funciona tu mente y llevá la teoría al cuerpo con ejercicios fáciles para volver al
                    presente.
                  </p>
                </div>

                <div className="flex flex-col gap-4 items-stretch justify-center">
                  <a
                    href="https://forms.gle/w2CcwYfKJZMdxKns6"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full rounded-full py-6 text-lg font-semibold shadow-lg border-0 transition-transform duration-200 hover:scale-105 inline-flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, #FF6FA7 0%, #C01631 100%)",
                      color: "#FFFFFF",
                      textDecoration: "none",
                    }}
                  >
                    <Mail className="w-5 h-5 mr-2" />
                    Recibir en el mail
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CITA NAZARETH */}
      <section className="py-20" style={{ background: "linear-gradient(to bottom, #8B1A28, #FFF5F5)" }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div
              className="relative rounded-3xl p-8 md:p-12 shadow-xl overflow-hidden bg-white/90"
              style={{
                background: "radial-gradient(circle at top left, #FFE6F0 0%, #F5EDE4 45%, #FDECEC 100%)",
                border: "1px solid rgba(164, 29, 45, 0.18)",
              }}
            >
              <div
                className="pointer-events-none absolute -bottom-16 right-0 w-56 h-56 opacity-40"
                style={{
                  background:
                    "radial-gradient(circle at center, rgba(255,255,255,0.8) 0%, rgba(244,143,177,0.3) 45%, transparent 70%)",
                }}
              />
              <div className="relative space-y-6 text-center md:text-left" style={{ color: "#4A0000" }}>
                <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                  <div
                    className="flex items-center justify-center w-11 h-11 rounded-full shadow-md"
                    style={{
                      background: "linear-gradient(135deg, #A41D2D, #8B1A28)",
                      color: "white",
                    }}
                  >
                    <Quote className="w-5 h-5" />
                  </div>
                  <span
                    className="text-xs md:text-sm font-semibold tracking-[0.18em] uppercase"
                    style={{ color: "#A41D2D" }}
                  >
                    Cita para pausar
                  </span>
                </div>

                <p className="text-base md:text-lg leading-relaxed italic font-medium">
                  “Las ondas <strong>alpha</strong> son claves en la sensación de confianza en nuestra introspección o
                  en nuestras decisiones. La aparición de ondas lentas en el cerebro contrarresta la tendencia neuronal
                  a la divagación mental, especialmente en situaciones de valoración de uno mismo. Ese efecto
                  escurridizo del cerebro con el que tantas veces debemos lidiar.”
                </p>

                <p className="text-base leading-relaxed font-semibold md:text-lg">
                  De estos experimentos podríamos concluir, como de tantos otros, que la <strong>calma mental</strong>{" "}
                  es la antesala indispensable de una buena acción. <strong>Técnicas de relajación</strong>, como las
                  que nos puede proporcionar la <strong>respiración</strong>, propician la aparición de ondas lentas en
                  el cerebro.
                </p>

                <div
                  className="pt-4 mt-2 border-t flex flex-col md:flex-row md:items-center md:justify-between gap-1"
                  style={{ borderColor: "rgba(164, 29, 45, 0.2)" }}
                >
                  <p className="text-sm md:text-base font-semibold" style={{ color: "#A41D2D" }}>
                    — Nazareth Castellanos
                  </p>
                  <p className="text-xs md:text-sm italic" style={{ color: "#6B0505" }}>
                    <em>El puente donde habitan las mariposas</em>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INSTAGRAM + FAQ */}
      <section
        className="py-20"
        style={{
          background: "radial-gradient(circle at top, #FFE6EB 0%, #FDECEC 45%, #F8C8D0 100%)",
        }}
      >
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 md:items-center gap-12 md:gap-16 max-w-7xl mx-auto rounded-[32px] bg-white/70 shadow-[0_20px_45px_rgba(164,29,45,0.2)] p-6 md:p-10 backdrop-blur-sm">
            {/* Left column: Instagram */}
            <div className="flex flex-col">
              <div className="flex-1">
                <div className="relative w-full" style={{ paddingBottom: "125%" }}>
                  <iframe
                    src="https://www.instagram.com/p/DPSaVdqDuSL/embed/"
                    className="absolute top-0 left-0 w-full h-full border-0 rounded-lg shadow-lg"
                    frameBorder={0}
                    scrolling="no"
                    allowTransparency
                    allow="encrypted-media"
                  />
                </div>

                <div className="text-center md:text-left mt-8">
                  <p className="text-lg font-semibold mb-2" style={{ color: "#A41D2D" }}>
                    ¿Querés conectar más con este tipo de info?
                  </p>
                  <p className="text-base leading-relaxed" style={{ color: "#4A0000" }}>
                    Comparto tips, reflexiones y el día a día de ByLou Yoga :)
                  </p>
                </div>
              </div>
            </div>

            {/* Right column: FAQ */}
            <div className="flex flex-col justify-center" id="faq">
              <div className="flex items-center justify-center md:justify-start gap-3 mb-6 md:mb-8">
                <h2 className="text-xl md:text-2xl font-bold" style={{ color: "#A41D2D" }}>
                  Preguntas frecuentes
                </h2>
              </div>

              <div className="flex-1 max-w-xl mx-auto md:mx-0">
                <Accordion type="single" collapsible className="space-y-4">
                  {/* ITEM 1 */}
                  <AccordionItem
                    value="item-1"
                    className="overflow-hidden rounded-3xl border px-1 shadow-[0_10px_24px_rgba(164,29,45,0.12)] transition-all data-[state=open]:shadow-[0_16px_32px_rgba(164,29,45,0.2)]"
                    style={{
                      borderColor: "#E89DB2",
                      borderWidth: "2px",
                      background:
                        "linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 70%, #FFEAF3 100%)",
                    }}
                  >
                    <AccordionTrigger
                      className="flex w-full items-center justify-between gap-3 px-5 md:px-6 py-3 md:py-4 text-left text-sm md:text-base font-semibold hover:no-underline"
                      style={{ color: "#A41D2D" }}
                    >
                      <span>¿Qué necesito para empezar si nunca practiqué?</span>
                    </AccordionTrigger>
                    <AccordionContent
                      className="px-5 md:px-6 pb-4 pt-1 text-xs md:text-sm"
                      style={{ color: "#4F4F4F", lineHeight: "1.7" }}
                    >
                      Solo necesitás un mat y un espacio tranquilo donde puedas
                      moverte sin distracciones.
                    </AccordionContent>
                  </AccordionItem>

                  {/* ITEM 2 */}
                  <AccordionItem
                    value="item-2"
                    className="overflow-hidden rounded-3xl border px-1 shadow-[0_10px_24px_rgba(164,29,45,0.12)] transition-all data-[state=open]:shadow-[0_16px_32px_rgba(164,29,45,0.2)]"
                    style={{
                      borderColor: "#E89DB2",
                      borderWidth: "2px",
                      background:
                        "linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 70%, #FFEAF3 100%)",
                    }}
                  >
                    <AccordionTrigger
                      className="flex w-full items-center justify-between gap-3 px-5 md:px-6 py-3 md:py-4 text-left text-sm md:text-base font-semibold hover:no-underline"
                      style={{ color: "#A41D2D" }}
                    >
                      <span>¿Clases individuales o grupales: cuál me conviene?</span>
                    </AccordionTrigger>
                    <AccordionContent
                      className="px-5 md:px-6 pb-4 pt-1 text-xs md:text-sm"
                      style={{ color: "#4F4F4F", lineHeight: "1.7" }}
                    >
                      Individual: foco 100% en tus objetivos y necesidades.
                      Grupal: energía compartida, motivación y costo más accesible.
                    </AccordionContent>
                  </AccordionItem>

                  {/* ITEM 3 */}
                  <AccordionItem
                    value="item-3"
                    className="overflow-hidden rounded-3xl border px-1 shadow-[0_10px_24px_rgba(164,29,45,0.12)] transition-all data-[state=open]:shadow-[0_16px_32px_rgba(164,29,45,0.2)]"
                    style={{
                      borderColor: "#E89DB2",
                      borderWidth: "2px",
                      background:
                        "linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 70%, #FFEAF3 100%)",
                    }}
                  >
                    <AccordionTrigger
                      className="flex w-full items-center justify-between gap-3 px-5 md:px-6 py-3 md:py-4 text-left text-sm md:text-base font-semibold hover:no-underline"
                      style={{ color: "#A41D2D" }}
                    >
                      <span>¿Necesito equipamiento especial?</span>
                    </AccordionTrigger>
                    <AccordionContent
                      className="px-5 md:px-6 pb-4 pt-1 text-xs md:text-sm"
                      style={{ color: "#4F4F4F", lineHeight: "1.7" }}
                    >
                      No es obligatorio. Si tenés, podés usar bloques, manta y
                      bolster para adaptar posturas y cuidar articulaciones.
                    </AccordionContent>
                  </AccordionItem>

                  {/* ITEM 4 */}
                  <AccordionItem
                    value="item-4"
                    className="overflow-hidden rounded-3xl border px-1 shadow-[0_10px_24px_rgba(164,29,45,0.12)] transition-all data-[state=open]:shadow-[0_16px_32px_rgba(164,29,45,0.2)]"
                    style={{
                      borderColor: "#E89DB2",
                      borderWidth: "2px",
                      background:
                        "linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 70%, #FFEAF3 100%)",
                    }}
                  >
                    <AccordionTrigger
                      className="flex w-full items-center justify-between gap-3 px-5 md:px-6 py-3 md:py-4 text-left text-sm md:text-base font-semibold hover:no-underline"
                      style={{ color: "#A41D2D" }}
                    >
                      <span>¿Qué beneficios tiene integrar neurociencia al yoga?</span>
                    </AccordionTrigger>
                    <AccordionContent
                      className="px-5 md:px-6 pb-4 pt-1 text-xs md:text-sm"
                      style={{ color: "#4F4F4F", lineHeight: "1.7" }}
                    >
                      Diseñamos la práctica para regular el sistema nervioso,
                      mejorar el sueño, la atención y la gestión del estrés,
                      apoyándonos en respiración, movimiento y hábitos.
                    </AccordionContent>
                  </AccordionItem>

                  {/* ITEM 5 */}
                  <AccordionItem
                    value="item-5"
                    className="overflow-hidden rounded-3xl border px-1 shadow-[0_10px_24px_rgba(164,29,45,0.12)] transition-all data-[state=open]:shadow-[0_16px_32px_rgba(164,29,45,0.2)]"
                    style={{
                      borderColor: "#E89DB2",
                      borderWidth: "2px",
                      background:
                        "linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 70%, #FFEAF3 100%)",
                    }}
                  >
                    <AccordionTrigger
                      className="flex w-full items-center justify-between gap-3 px-5 md:px-6 py-3 md:py-4 text-left text-sm md:text-base font-semibold hover:no-underline"
                      style={{ color: "#A41D2D" }}
                    >
                      <span>¿Cómo funcionan los packs y la reserva?</span>
                    </AccordionTrigger>
                    <AccordionContent
                      className="px-5 md:px-6 pb-4 pt-1 text-xs md:text-sm"
                      style={{ color: "#4F4F4F", lineHeight: "1.7" }}
                    >
                      Coordinamos el horario y, una vez que elegís tu pack, lo
                      abonás y queda habilitado por 30 días. Después reservás tus
                      clases desde una plataforma, donde podés ver los horarios
                      disponibles y organizarte con comodidad.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DIALOG GUÍA */}
      <Dialog open={isGuideModalOpen} onOpenChange={setIsGuideModalOpen}>
        <DialogContent className="sm:max-w-md" style={{ backgroundColor: "#FFF5F5", borderColor: "#A41D2D" }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold text-center" style={{ color: "#A41D2D" }}>
              Recibir Guía Anti-Estrés
            </DialogTitle>
            <DialogDescription className="text-center" style={{ color: "#4A0000" }}>
              Dejanos tus datos y te enviaremos la guía gratuita por email.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGuideSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <label htmlFor="guide-name" className="text-sm font-medium" style={{ color: "#A41D2D" }}>
                Nombre
              </label>
              <Input
                id="guide-name"
                type="text"
                placeholder="Tu nombre"
                value={guideName}
                onChange={(e) => setGuideName(e.target.value)}
                required
                className="border-2"
                style={{ borderColor: "#A41D2D", backgroundColor: "white" }}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="guide-email" className="text-sm font-medium" style={{ color: "#A41D2D" }}>
                Email
              </label>
              <Input
                id="guide-email"
                type="email"
                placeholder="tu@email.com"
                value={guideEmail}
                onChange={(e) => setGuideEmail(e.target.value)}
                required
                className="border-2"
                style={{ borderColor: "#A41D2D", backgroundColor: "white" }}
              />
            </div>
            <Button
              type="submit"
              className="w-full rounded-full py-6 text-lg font-semibold"
              style={{
                background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                color: "white",
              }}
            >
              <Mail className="w-5 h-5 mr-2" />
              Enviar solicitud
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* CONTACTO */}
      <section
        id="contacto"
        className="py-20 scroll-mt-24"
        style={{
          background: "radial-gradient(circle at top, #FFE6EB 0%, #FDECEC 45%, #F8C8D0 100%)",
        }}
      >
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <div
              className="inline-flex items-center gap-2 px-4 py-1 mb-4 rounded-full text-xs font-semibold tracking-[0.12em] uppercase"
              style={{
                backgroundColor: "rgba(255,255,255,0.85)",
                color: "#A41D2D",
                border: "1px solid rgba(164,29,45,0.15)",
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#A41D2D" }} />
              <span>Próximo paso</span>
            </div>

            <div className="flex items-center justify-center gap-3 mb-6">
              <h2 className="text-3xl md:text-4xl font-bold" style={{ color: "#A41D2D" }}>
                ¿Reservamos tu primera sesión?
              </h2>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <a
                href={instagramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 text-lg px-8 py-6 rounded-full font-medium transition-all shadow-lg hover:shadow-xl"
                style={{
                  background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                  color: "white",
                }}
                aria-label="Enviar mensaje por Instagram"
              >
                <Instagram className="w-5 h-5" />
                Enviar mensaje por Instagram
              </a>
            </div>

            <Card
              className="mt-6 shadow-[0_20px_45px_rgba(164,29,45,0.18)]"
              style={{
                background: "radial-gradient(circle at top, #FFFFFF 0%, #FFF5F5 40%, #FDECEC 100%)",
                borderRadius: "24px",
                border: "1px solid rgba(164,29,45,0.15)",
              }}
            >
              <CardHeader>
                <CardTitle style={{ color: "#A41D2D" }}>O escribime directamente</CardTitle>
                <CardDescription style={{ color: "#4A0000" }}>Te respondo a la brevedad por email</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input id="contact-name" name="name" placeholder="Tu nombre" required />
                    <Input id="contact-email" name="email" type="email" placeholder="Tu email" required />
                  </div>
                  <Textarea
                    id="contact-message"
                    name="message"
                    placeholder="Contame qué te interesa..."
                    rows={4}
                    required
                  />
                  <Button
                    type="submit"
                    className="w-full rounded-full py-6 shadow-lg"
                    aria-label="Enviar mensaje por email"
                    style={{
                      background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
                      color: "white",
                    }}
                  >
                    Enviar mensaje
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="mt-8 space-y-2">
              <Button
                variant="outline"
                asChild
                className="rounded-full px-6 py-3 bg-transparent"
                style={{
                  borderColor: "#A41D2D",
                  borderWidth: "2px",
                  color: "#A41D2D",
                  background: "linear-gradient(135deg, #FDECEC 0%, #FFFFFF 100%)",
                }}
              >
                <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                  <Instagram className="w-4 h-4 mr-2" />
                  Seguime en Instagram
                </a>
              </Button>
              <p className="text-sm" style={{ color: "#4A0000" }}>
                Email:{" "}
                <a href={`mailto:${emailAddress}`} className="hover:underline" style={{ color: "#A41D2D" }}>
                  {emailAddress}
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8" style={{ backgroundColor: "#F5EDE4" }}>
        <div className="container mx-auto px-4 text-center">
          <p style={{ color: "#4A0000" }}>© 2025 ByLou Yoga. Todos los derechos reservados.</p>
          <p className="text-sm mt-2" style={{ color: "#6B0505" }}>
            Contacto: {emailAddress}
          </p>
        </div>
      </footer>

      {/* BOTÓN FLOTANTE MOBILE */}
      <div className="fixed bottom-6 right-6 md:hidden z-40">
        <Button
          size="lg"
          className="rounded-full shadow-2xl w-16 h-16"
          asChild
          style={{
            background: "linear-gradient(135deg, #A41D2D 0%, #8B1A28 100%)",
            color: "white",
          }}
        >
          <a href={instagramLink} target="_blank" rel="noopener noreferrer">
            <Instagram className="w-6 h-6" />
          </a>
        </Button>
      </div>
    </div>
  )
}
