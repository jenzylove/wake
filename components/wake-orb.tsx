"use client"

import * as React from "react"

// A frosted glass sphere holding concentric wavefronts: the wake left behind
// once something disturbs the surface. Rendered rather than faked with CSS
// gradients, because transmission, refraction and a real specular response are
// what separate glass from a balloon.

const ACCENT = 0xc2672f
const ACCENT_SOFT = 0xe2a06a

export function WakeOrb() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let cleanup: (() => void) | undefined

    void (async () => {
      const THREE = await import("three")
      if (disposed) return

      let renderer: import("three").WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" })
        if (!renderer.getContext()) throw new Error("no webgl")
      } catch {
        setFailed(true)
        return
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setClearColor(0x000000, 0)

      // Studio dome plus softboxes. A dark room would read as a plastic ball;
      // the sphere needs something bright and graded to refract.
      const envScene = new THREE.Scene()
      envScene.add(new THREE.Mesh(
        new THREE.SphereGeometry(10, 48, 32),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
          fragmentShader: `varying vec3 vP;
            void main(){
              float h = vP.y*0.5+0.5;
              vec3 low = vec3(0.78,0.62,0.48), mid = vec3(0.90,0.90,0.94), top = vec3(1.0);
              vec3 c = mix(low, mid, smoothstep(0.0,0.55,h));
              c = mix(c, top, smoothstep(0.55,1.0,h));
              gl_FragColor = vec4(c,1.0);
            }`,
        }),
      ))
      const softbox = (w: number, h: number, x: number, y: number, z: number, s = 3) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(s, s, s), side: THREE.DoubleSide }))
        m.position.set(x, y, z)
        m.lookAt(0, 0, 0)
        envScene.add(m)
      }
      softbox(4, 2.4, -4, 5, 5, 4.2)
      softbox(3, 3, 5, 1, 4, 2.6)
      softbox(6, 2, 0, -4, 3, 1.4)

      const pmrem = new THREE.PMREMGenerator(renderer)
      const envMap = pmrem.fromScene(envScene, 0.02).texture

      const scene = new THREE.Scene()
      scene.environment = envMap

      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
      camera.position.set(0, 0, 7.1)

      const group = new THREE.Group()
      scene.add(group)

      // The wake: rings expanding from the origin, each fading as it widens.
      const ringCount = 5
      const rings: Array<{ mesh: import("three").Mesh; offset: number }> = []
      for (let i = 0; i < ringCount; i += 1) {
        const mesh = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.042, 20, 180),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(i === 0 ? ACCENT : ACCENT_SOFT),
            roughness: 0.28,
            metalness: 0.05,
            emissive: new THREE.Color(ACCENT),
            emissiveIntensity: 0.32,
            transparent: true,
            opacity: 0.9,
          }),
        )
        mesh.rotation.x = Math.PI / 2.3
        group.add(mesh)
        rings.push({ mesh, offset: i / ringCount })
      }

      // The disturbance that produced them.
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 32, 24),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(ACCENT), roughness: 0.22, metalness: 0.1, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.5 }),
      )
      group.add(core)

      // A fresnel shell rather than a transmissive one. transmission needs a
      // framebuffer copy that silently degrades to opaque frosted plastic on
      // software and some mobile contexts, which buries everything inside it.
      // Fresnel is bright at grazing angles and clear face on, so the shell
      // reads as a thin glass bubble everywhere and the wavefronts stay the
      // subject.
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(1.94, 96, 72),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            uRim: { value: new THREE.Color(0xffffff) },
            uTint: { value: new THREE.Color(0xe9d9c8) },
          },
          vertexShader: `
            varying vec3 vN; varying vec3 vV;
            void main(){
              vec4 wp = modelMatrix * vec4(position, 1.0);
              vN = normalize(mat3(modelMatrix) * normal);
              vV = normalize(cameraPosition - wp.xyz);
              gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
          fragmentShader: `
            varying vec3 vN; varying vec3 vV;
            uniform vec3 uRim; uniform vec3 uTint;
            void main(){
              float f = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
              float rim = pow(f, 3.2);
              float body = pow(f, 1.1) * 0.13;
              vec3 c = mix(uTint, uRim, rim);
              gl_FragColor = vec4(c, clamp(rim * 0.92 + body, 0.0, 1.0));
            }`,
        }),
      )
      scene.add(shell)

      const resize = () => {
        const rect = canvas.getBoundingClientRect()
        const size = Math.max(1, Math.min(rect.width, rect.height))
        renderer.setSize(size, size, false)
        camera.aspect = 1
        camera.updateProjectionMatrix()
      }
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const clock = new THREE.Clock()
      let frame = 0

      const tick = () => {
        frame = requestAnimationFrame(tick)
        const t = reduced ? 3.4 : clock.getElapsedTime()

        for (const { mesh, offset } of rings) {
          // Each ring travels out, thins, and fades, then restarts.
          const p = (t * 0.17 + offset) % 1
          const scale = 0.2 + p * 1.62
          mesh.scale.setScalar(scale)
          const mat = mesh.material as import("three").MeshStandardMaterial
          mat.opacity = Math.sin(Math.PI * Math.min(p / 0.92, 1)) * 0.92
        }
        core.scale.setScalar(1 + Math.sin(t * 1.1) * 0.06)

        group.rotation.y = Math.sin(t * 0.14) * 0.3
        group.rotation.z = Math.cos(t * 0.11) * 0.12
        shell.rotation.y = t * 0.035

        renderer.render(scene, camera)
        if (reduced) cancelAnimationFrame(frame)
      }
      tick()

      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        pmrem.dispose()
        envMap.dispose()
        renderer.dispose()
        scene.traverse((o) => {
          const mesh = o as import("three").Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          const mat = mesh.material as import("three").Material | import("three").Material[] | undefined
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
        })
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  return (
    <div className="orb-wrap" aria-hidden="true">
      <div className="orb-glow" />
      {failed ? <div className="orb-fallback" /> : <canvas ref={canvasRef} className="orb-canvas" />}
    </div>
  )
}
