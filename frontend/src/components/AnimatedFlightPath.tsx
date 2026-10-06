import { useReducedMotion } from 'motion/react';
import { Plane } from 'lucide-react';
import type { missionProfiles } from '../lib/data';

type MissionProfile = (typeof missionProfiles)[number];

export function AnimatedFlightPath({ mission, moving, showPlanned = true, revision = 0 }: { mission: MissionProfile; moving: boolean; showPlanned?: boolean; revision?: number }) {
  const reduceMotion = useReducedMotion();
  const shouldMove = moving && !reduceMotion;

  return (
    <g className="flight-overlay" key={`${mission.id}-${revision}`}>
      {showPlanned ? <path className="planned-route" d={mission.plannedRoute} /> : null}
      <path className={moving ? 'actual-route running' : 'actual-route'} d={mission.actualRoute} />
      <g className={shouldMove ? 'drone-point drone-moving' : 'drone-point'} transform={`translate(${mission.droneX} ${mission.droneY})`}>
        <path className="scan-fan" d="M0 0 L92 -44 A102 102 0 0 1 92 44 Z" />
        <circle className="drone-aura" r="32" />
        <circle className="drone-core" r="20" />
        <Plane className="drone-glyph" x="-11" y="-11" width="22" height="22" />
        {shouldMove ? <animateMotion dur="16s" repeatCount="indefinite" path={mission.actualRoute} rotate="auto" /> : null}
      </g>
    </g>
  );
}
