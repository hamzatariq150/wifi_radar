import { useState, useEffect, useRef, useCallback } from 'react';

// Types
interface Point {
  x: number;
  y: number;
}

interface Wall {
  start: Point;
  end: Point;
  detected: boolean;
  confidence: number;
  label?: string;
}

interface Room {
  points: Point[];
  label: string;
  color: string;
}

interface SignalPoint {
  x: number;
  y: number;
  strength: number;
  angle: number;
  distance: number;
  timestamp: number;
}

interface ScanData {
  points: SignalPoint[];
  walls: Wall[];
  rooms: Room[];
  scanAngle: number;
  isScanning: boolean;
}

// Default house layout (walls that define the space)
const DEFAULT_HOUSE_WALLS: Wall[] = [
  // Outer walls
  { start: { x: 80, y: 80 }, end: { x: 520, y: 80 }, detected: false, confidence: 0, label: 'North Wall' },
  { start: { x: 520, y: 80 }, end: { x: 520, y: 420 }, detected: false, confidence: 0, label: 'East Wall' },
  { start: { x: 520, y: 420 }, end: { x: 80, y: 420 }, detected: false, confidence: 0, label: 'South Wall' },
  { start: { x: 80, y: 420 }, end: { x: 80, y: 80 }, detected: false, confidence: 0, label: 'West Wall' },
  // Inner walls - Living room / Kitchen divider
  { start: { x: 300, y: 80 }, end: { x: 300, y: 220 }, detected: false, confidence: 0, label: 'Kitchen Wall' },
  // Bedroom wall
  { start: { x: 80, y: 250 }, end: { x: 250, y: 250 }, detected: false, confidence: 0, label: 'Bedroom Wall' },
  // Bathroom
  { start: { x: 400, y: 250 }, end: { x: 400, y: 420 }, detected: false, confidence: 0, label: 'Bathroom Wall' },
  { start: { x: 400, y: 250 }, end: { x: 520, y: 250 }, detected: false, confidence: 0, label: 'Bathroom Wall 2' },
  // Hallway
  { start: { x: 250, y: 250 }, end: { x: 250, y: 350 }, detected: false, confidence: 0, label: 'Hallway Wall' },
];

const DEFAULT_ROOMS: Room[] = [
  { points: [{ x: 300, y: 80 }, { x: 520, y: 80 }, { x: 520, y: 250 }, { x: 400, y: 250 }, { x: 400, y: 420 }, { x: 300, y: 420 }, { x: 300, y: 220 }], label: 'Kitchen', color: 'rgba(0, 255, 136, 0.1)' },
  { points: [{ x: 80, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 250 }, { x: 250, y: 250 }, { x: 250, y: 350 }, { x: 80, y: 350 }, { x: 80, y: 250 }], label: 'Living Room', color: 'rgba(0, 136, 255, 0.1)' },
  { points: [{ x: 80, y: 250 }, { x: 250, y: 250 }, { x: 250, y: 420 }, { x: 80, y: 420 }], label: 'Bedroom', color: 'rgba(255, 136, 0, 0.1)' },
  { points: [{ x: 400, y: 250 }, { x: 520, y: 250 }, { x: 520, y: 420 }, { x: 400, y: 420 }], label: 'Bathroom', color: 'rgba(136, 0, 255, 0.1)' },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const sweepAngleRef = useRef<number>(0);
  const detectedPointsRef = useRef<SignalPoint[]>([]);
  const detectedWallsRef = useRef<Wall[]>([]);
  const routerPosRef = useRef<Point>({ x: 300, y: 250 });

  const [isScanning, setIsScanning] = useState(false);
  const [scanSpeed, setScanSpeed] = useState(2);
  const [scanRange, setScanRange] = useState(250);
  const [signalPower, setSignalPower] = useState(80);
  const [showGrid, setShowGrid] = useState(true);
  const [showRooms, setShowRooms] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);
  const [wallConfidence, setWallConfidence] = useState(0);
  const [activeTab, setActiveTab] = useState<'radar' | 'map' | 'both'>('both');
  const [routerPos, setRouterPos] = useState<Point>({ x: 300, y: 250 });
  const [isDragging, setIsDragging] = useState(false);
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [frequency, setFrequency] = useState<'2.4ghz' | '5ghz' | '6ghz'>('2.4ghz');

  const freqMultiplier = frequency === '2.4ghz' ? 1.0 : frequency === '5ghz' ? 0.7 : 0.5;

  // Check if a point is near a wall
  const checkWallDetection = useCallback((angle: number, distance: number): { hit: boolean; wall: Wall | null } => {
    const router = routerPosRef.current;
    const endX = router.x + Math.cos(angle) * distance;
    const endY = router.y + Math.sin(angle) * distance;

    for (const wall of DEFAULT_HOUSE_WALLS) {
      const intersection = lineIntersection(
        router, { x: endX, y: endY },
        wall.start, wall.end
      );
      if (intersection) {
        const dist = Math.sqrt(
          Math.pow(intersection.x - router.x, 2) + Math.pow(intersection.y - router.y, 2)
        );
        if (dist <= scanRange * freqMultiplier) {
          return { hit: true, wall };
        }
      }
    }
    return { hit: false, wall: null };
  }, [scanRange, freqMultiplier]);

  // Line intersection algorithm
  const lineIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(denom) < 0.001) return null;

    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;

    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return {
        x: p1.x + ua * (p2.x - p1.x),
        y: p1.y + ua * (p2.y - p1.y)
      };
    }
    return null;
  };

  // Draw radar view
  const drawRadar = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 20;

    // Clear
    ctx.fillStyle = 'rgba(5, 5, 15, 0.95)';
    ctx.fillRect(0, 0, width, height);

    // Draw grid circles
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, (radius / 5) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw grid lines
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI * 2) / 12;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      ctx.stroke();
    }

    // Draw range indicator
    const rangeRadius = (scanRange * freqMultiplier / 300) * radius;
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, rangeRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw detected points
    if (showSignals) {
      detectedPointsRef.current.forEach((point) => {
        const normalizedDist = (point.distance / (scanRange * freqMultiplier)) * radius;
        const px = centerX + Math.cos(point.angle) * normalizedDist;
        const py = centerY + Math.sin(point.angle) * normalizedDist;
        const alpha = Math.max(0.1, 1 - (Date.now() - point.timestamp) / 5000);
        
        ctx.fillStyle = `rgba(0, 255, 136, ${alpha * (point.strength / 100)})`;
        ctx.beginPath();
        ctx.arc(px, py, 2 + point.strength / 30, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw sweep line
    if (isScanning) {
      const sweepAngle = sweepAngleRef.current;
      
      // Draw sweep area
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(sweepAngle);
      
      const sweepGrad = ctx.createLinearGradient(0, 0, radius, 0);
      sweepGrad.addColorStop(0, 'rgba(0, 255, 136, 0.4)');
      sweepGrad.addColorStop(1, 'rgba(0, 255, 136, 0)');
      
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, -0.1, 0.1);
      ctx.closePath();
      ctx.fill();
      
      // Sweep line
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(radius, 0);
      ctx.stroke();
      
      ctx.restore();

      // Signal waves from router
      const waveRadius = ((Date.now() % 2000) / 2000) * radius;
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.3 * (1 - waveRadius / radius)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw router (center)
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Router icon
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Outer ring
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', centerX, centerY - radius + 15);
    ctx.fillText('S', centerX, centerY + radius - 8);
    ctx.fillText('E', centerX + radius - 10, centerY + 4);
    ctx.fillText('W', centerX - radius + 10, centerY + 4);

    // Distance labels
    for (let i = 1; i <= 5; i++) {
      const dist = Math.round((scanRange * freqMultiplier / 5) * i);
      ctx.fillText(`${dist}m`, centerX + 5, centerY - (radius / 5) * i + 12);
    }
  }, [isScanning, showSignals, scanRange, freqMultiplier]);

  // Draw map view
  const drawMap = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Clear
    ctx.fillStyle = 'rgba(5, 5, 15, 0.95)';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw rooms (background)
    if (showRooms) {
      DEFAULT_ROOMS.forEach((room) => {
        ctx.fillStyle = room.color;
        ctx.beginPath();
        ctx.moveTo(room.points[0].x, room.points[0].y);
        room.points.forEach((p, i) => {
          if (i > 0) ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fill();

        // Room label
        const cx = room.points.reduce((sum, p) => sum + p.x, 0) / room.points.length;
        const cy = room.points.reduce((sum, p) => sum + p.y, 0) / room.points.length;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(room.label, cx, cy);
      });
    }

    // Draw detected walls
    DEFAULT_HOUSE_WALLS.forEach((wall, index) => {
      const detectedWall = detectedWallsRef.current[index];
      const confidence = detectedWall?.confidence || 0;
      
      if (confidence > 0) {
        // Detected wall glow
        ctx.strokeStyle = `rgba(0, 255, 136, ${confidence / 100})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(0, 255, 136, 0.5)';
        ctx.shadowBlur = confidence / 10;
        ctx.beginPath();
        ctx.moveTo(wall.start.x, wall.start.y);
        ctx.lineTo(wall.end.x, wall.end.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Base wall
      const alpha = confidence > 0 ? 0.8 : 0.15;
      ctx.strokeStyle = `rgba(0, 255, 136, ${alpha})`;
      ctx.lineWidth = confidence > 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(wall.start.x, wall.start.y);
      ctx.lineTo(wall.end.x, wall.end.y);
      ctx.stroke();
    });

    // Draw detected signal points on map
    if (showSignals) {
      detectedPointsRef.current.forEach((point) => {
        const alpha = Math.max(0.05, 1 - (Date.now() - point.timestamp) / 8000);
        ctx.fillStyle = `rgba(0, 200, 255, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw router position
    const router = routerPosRef.current;
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(router.x, router.y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Router signal rings
    if (isScanning) {
      for (let i = 1; i <= 3; i++) {
        const ringRadius = ((Date.now() / (1000 / scanSpeed) + i * 80) % (scanRange * freqMultiplier));
        const alpha = 0.3 * (1 - ringRadius / (scanRange * freqMultiplier));
        ctx.strokeStyle = `rgba(0, 255, 136, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(router.x, router.y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // WiFi icon at router
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(router.x, router.y, 12 + i * 6, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
    }

    // Scale indicator
    ctx.fillStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Scale: 1px = 0.5m', 10, height - 10);
    
    // Compass
    ctx.fillStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('N ↑', width - 10, 20);
  }, [showGrid, showRooms, showSignals, isScanning, scanSpeed, scanRange, freqMultiplier]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const mapCanvas = mapCanvasRef.current;
    if (!canvas || !mapCanvas) return;

    const ctx = canvas.getContext('2d');
    const mapCtx = mapCanvas.getContext('2d');
    if (!ctx || !mapCtx) return;

    let lastTime = 0;

    const animate = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      // Resize canvases
      const radarContainer = canvas.parentElement;
      const mapContainer = mapCanvas.parentElement;
      
      if (radarContainer) {
        canvas.width = radarContainer.clientWidth;
        canvas.height = radarContainer.clientHeight;
      }
      if (mapContainer) {
        mapCanvas.width = mapContainer.clientWidth;
        mapCanvas.height = mapContainer.clientHeight;
      }

      // Update sweep angle
      if (isScanning) {
        sweepAngleRef.current += (scanSpeed * 0.02 * deltaTime) / 16;
        if (sweepAngleRef.current > Math.PI * 2) {
          sweepAngleRef.current -= Math.PI * 2;
        }

        // Detect walls at current angle
        const numRays = 3;
        for (let i = 0; i < numRays; i++) {
          const angle = sweepAngleRef.current + (i - 1) * 0.02;
          const maxDist = scanRange * freqMultiplier;
          
          for (let dist = 10; dist < maxDist; dist += 5) {
            const result = checkWallDetection(angle, dist);
            if (result.hit && result.wall) {
              const wallIndex = DEFAULT_HOUSE_WALLS.indexOf(result.wall);
              
              // Add signal point
              const router = routerPosRef.current;
              const hitX = router.x + Math.cos(angle) * dist;
              const hitY = router.y + Math.sin(angle) * dist;
              
              // Convert to radar coordinates
              const radarCenterX = canvas.width / 2;
              const radarCenterY = canvas.height / 2;
              const radarRadius = Math.min(canvas.width, canvas.height) / 2 - 20;
              const normalizedDist = (dist / maxDist) * radarRadius;
              
              detectedPointsRef.current.push({
                x: hitX,
                y: hitY,
                strength: signalPower * (1 - dist / maxDist) * freqMultiplier,
                angle: angle,
                distance: dist,
                timestamp: Date.now()
              });

              // Update wall detection confidence
              if (!detectedWallsRef.current[wallIndex]) {
                detectedWallsRef.current[wallIndex] = { ...DEFAULT_HOUSE_WALLS[wallIndex], detected: true, confidence: 0 };
              }
              detectedWallsRef.current[wallIndex].confidence = Math.min(100, 
                (detectedWallsRef.current[wallIndex]?.confidence || 0) + 0.5
              );

              break;
            }
          }
        }

        // Clean old points
        detectedPointsRef.current = detectedPointsRef.current.filter(
          p => Date.now() - p.timestamp < 8000
        );

        // Update stats
        const totalConfidence = detectedWallsRef.current.reduce((sum, w) => sum + (w?.confidence || 0), 0);
        const avgConfidence = totalConfidence / DEFAULT_HOUSE_WALLS.length;
        setWallConfidence(Math.round(avgConfidence));
        setDetectedCount(detectedPointsRef.current.length);
        setScanProgress(Math.round((sweepAngleRef.current / (Math.PI * 2)) * 100));
      }

      // Draw
      drawRadar(ctx, canvas.width, canvas.height);
      drawMap(mapCtx, mapCanvas.width, mapCanvas.height);

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isScanning, scanSpeed, scanRange, signalPower, showGrid, showRooms, showSignals, checkWallDetection, drawRadar, drawMap, freqMultiplier]);

  // Handle router drag
  const handleMapMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dist = Math.sqrt(Math.pow(x - routerPosRef.current.x, 2) + Math.pow(y - routerPosRef.current.y, 2));
    if (dist < 20) {
      setIsDragging(true);
    }
  };

  const handleMapMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(80, Math.min(520, e.clientX - rect.left));
    const y = Math.max(80, Math.min(420, e.clientY - rect.top));
    routerPosRef.current = { x, y };
    setRouterPos({ x, y });
  };

  const handleMapMouseUp = () => {
    setIsDragging(false);
  };

  const resetScan = () => {
    detectedPointsRef.current = [];
    detectedWallsRef.current = [];
    setDetectedCount(0);
    setWallConfidence(0);
    setScanProgress(0);
  };

  return (
    <div className="w-screen h-screen bg-[#0a0a0f] text-white font-mono flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-green-900/50 bg-[#0d0d15]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full border-2 border-green-400 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>
            {isScanning && (
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            )}
          </div>
          <div>
            <h1 className="text-sm font-bold text-green-400 tracking-wider">WiFi SPATIAL MAPPER</h1>
            <p className="text-[10px] text-green-600">RF Signal-Based Environment Mapping v2.1</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex bg-[#1a1a2e] rounded-lg overflow-hidden border border-green-900/30">
            {(['radar', 'map', 'both'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs uppercase tracking-wider transition-all ${
                  activeTab === tab 
                    ? 'bg-green-500/20 text-green-400 border-b-2 border-green-400' 
                    : 'text-green-700 hover:text-green-500'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-green-600">{isScanning ? 'SCANNING' : 'IDLE'}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <aside className="w-64 border-r border-green-900/30 bg-[#0d0d15]/60 p-3 overflow-y-auto flex flex-col gap-3">
          {/* Scan Controls */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              Scan Controls
            </h3>
            
            <button
              onClick={() => setIsScanning(!isScanning)}
              className={`w-full py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isScanning 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30' 
                  : 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 glow-effect'
              }`}
            >
              {isScanning ? '⏹ Stop Scan' : '▶ Start Scan'}
            </button>

            <button
              onClick={resetScan}
              className="w-full py-1.5 px-4 rounded-lg text-xs uppercase tracking-wider bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-all"
            >
              ↺ Reset Data
            </button>
          </div>

          {/* Parameters */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              Parameters
            </h3>

            <div>
              <label className="text-[10px] text-green-600 uppercase">Scan Speed</label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={scanSpeed}
                onChange={(e) => setScanSpeed(parseFloat(e.target.value))}
                className="w-full h-1 bg-green-900/50 rounded-lg appearance-none cursor-pointer accent-green-400"
              />
              <span className="text-[10px] text-green-500">{scanSpeed}x</span>
            </div>

            <div>
              <label className="text-[10px] text-green-600 uppercase">Range (meters)</label>
              <input
                type="range"
                min="50"
                max="300"
                step="10"
                value={scanRange}
                onChange={(e) => setScanRange(parseInt(e.target.value))}
                className="w-full h-1 bg-green-900/50 rounded-lg appearance-none cursor-pointer accent-green-400"
              />
              <span className="text-[10px] text-green-500">{scanRange}m</span>
            </div>

            <div>
              <label className="text-[10px] text-green-600 uppercase">Signal Power (%)</label>
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={signalPower}
                onChange={(e) => setSignalPower(parseInt(e.target.value))}
                className="w-full h-1 bg-green-900/50 rounded-lg appearance-none cursor-pointer accent-green-400"
              />
              <span className="text-[10px] text-green-500">{signalPower}%</span>
            </div>

            <div>
              <label className="text-[10px] text-green-600 uppercase">Frequency Band</label>
              <div className="flex gap-1 mt-1">
                {(['2.4ghz', '5ghz', '6ghz'] as const).map((freq) => (
                  <button
                    key={freq}
                    onClick={() => setFrequency(freq)}
                    className={`flex-1 py-1 text-[10px] rounded transition-all ${
                      frequency === freq
                        ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                        : 'bg-[#1a1a2e] text-green-700 border border-green-900/30 hover:border-green-700/50'
                    }`}
                  >
                    {freq === '2.4ghz' ? '2.4' : freq === '5ghz' ? '5' : '6'} GHz
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Display Options */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              Display
            </h3>

            {[
              { label: 'Grid Overlay', value: showGrid, setter: setShowGrid },
              { label: 'Room Labels', value: showRooms, setter: setShowRooms },
              { label: 'Signal Points', value: showSignals, setter: setShowSignals },
            ].map(({ label, value, setter }) => (
              <label key={label} className="flex items-center justify-between cursor-pointer">
                <span className="text-[10px] text-green-600">{label}</span>
                <div
                  onClick={() => setter(!value)}
                  className={`w-8 h-4 rounded-full transition-all relative ${
                    value ? 'bg-green-500/40' : 'bg-[#1a1a2e]'
                  }`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                    value ? 'left-4.5 bg-green-400' : 'left-0.5 bg-green-800'
                  }`} />
                </div>
              </label>
            ))}
          </div>

          {/* Stats */}
          <div className="space-y-2 mt-auto">
            <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              Statistics
            </h3>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#1a1a2e]/50 rounded-lg p-2 border border-green-900/20">
                <div className="text-[10px] text-green-700">Progress</div>
                <div className="text-sm text-green-400 font-bold">{scanProgress}%</div>
              </div>
              <div className="bg-[#1a1a2e]/50 rounded-lg p-2 border border-green-900/20">
                <div className="text-[10px] text-green-700">Points</div>
                <div className="text-sm text-green-400 font-bold">{detectedCount}</div>
              </div>
              <div className="bg-[#1a1a2e]/50 rounded-lg p-2 border border-green-900/20">
                <div className="text-[10px] text-green-700">Wall Conf.</div>
                <div className="text-sm text-green-400 font-bold">{wallConfidence}%</div>
              </div>
              <div className="bg-[#1a1a2e]/50 rounded-lg p-2 border border-green-900/20">
                <div className="text-[10px] text-green-700">Frequency</div>
                <div className="text-sm text-green-400 font-bold">{frequency === '2.4ghz' ? '2.4' : frequency === '5ghz' ? '5' : '6'}G</div>
              </div>
            </div>

            {/* Confidence bar */}
            <div>
              <div className="flex justify-between text-[10px] text-green-700 mb-1">
                <span>Map Completion</span>
                <span>{wallConfidence}%</span>
              </div>
              <div className="h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-300 rounded-full"
                  style={{ width: `${wallConfidence}%` }}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* Main View */}
        <main className="flex-1 flex overflow-hidden">
          {/* Radar View */}
          {(activeTab === 'radar' || activeTab === 'both') && (
            <div className={`relative border-r border-green-900/30 ${activeTab === 'both' ? 'w-1/2' : 'w-full'}`}>
              <div className="absolute top-2 left-2 z-10 bg-[#0d0d15]/80 px-2 py-1 rounded border border-green-900/30">
                <span className="text-[10px] text-green-500 uppercase tracking-wider">Radar View</span>
              </div>
              <canvas ref={canvasRef} className="w-full h-full" />
            </div>
          )}

          {/* Map View */}
          {(activeTab === 'map' || activeTab === 'both') && (
            <div className={`relative ${activeTab === 'both' ? 'w-1/2' : 'w-full'}`}>
              <div className="absolute top-2 left-2 z-10 bg-[#0d0d15]/80 px-2 py-1 rounded border border-green-900/30">
                <span className="text-[10px] text-green-500 uppercase tracking-wider">Spatial Map</span>
              </div>
              <div className="absolute top-2 right-2 z-10 bg-[#0d0d15]/80 px-2 py-1 rounded border border-green-900/30">
                <span className="text-[10px] text-green-600">Drag router to reposition</span>
              </div>
              <canvas 
                ref={mapCanvasRef} 
                className="w-full h-full cursor-crosshair"
                onMouseDown={handleMapMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={handleMapMouseUp}
                onMouseLeave={handleMapMouseUp}
              />
            </div>
          )}
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="flex items-center justify-between px-4 py-1.5 border-t border-green-900/30 bg-[#0d0d15]/80 text-[10px]">
        <div className="flex items-center gap-4">
          <span className="text-green-700">Router: ({Math.round(routerPos.x)}, {Math.round(routerPos.y)})</span>
          <span className="text-green-700">|</span>
          <span className="text-green-700">Band: {frequency.toUpperCase()}</span>
          <span className="text-green-700">|</span>
          <span className="text-green-700">Effective Range: {Math.round(scanRange * freqMultiplier)}m</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-green-700">Walls: {DEFAULT_HOUSE_WALLS.length}</span>
          <span className="text-green-700">|</span>
          <span className="text-green-700">Rooms: {DEFAULT_ROOMS.length}</span>
          <span className="text-green-700">|</span>
          <span className="text-green-600">WiFi Spatial Mapper © 2026</span>
        </div>
      </footer>
    </div>
  );
}
