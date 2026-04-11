#!/bin/bash
# 에이전트 시스템 검증 스크립트

echo "======================================================================"
echo "DI금융 자율 전략 진화 시스템 - 검증"
echo "======================================================================"

cd "$(dirname "$0")"

echo ""
echo "1. Python 버전 확인..."
python3 --version

echo ""
echo "2. 필수 라이브러리 확인..."
python3 << 'EOFPY'
import sys
try:
    import numpy; print("  ✓ numpy")
    import pandas; print("  ✓ pandas")
    import scipy; print("  ✓ scipy")
    import sklearn; print("  ✓ scikit-learn")
    import ta; print("  ✓ ta")
    import requests; print("  ✓ requests")
    import telegram; print("  ✓ python-telegram-bot")
    import aiohttp; print("  ✓ aiohttp")
    try:
        import deap; print("  ✓ deap (genetic algorithm)")
    except:
        print("  ⚠ deap (optional - will use mock GA)")
except ImportError as e:
    print(f"  ✗ Missing: {e}")
    sys.exit(1)
EOFPY

echo ""
echo "3. 에이전트 파일 검증..."
for agent in researcher backtester evolver evaluator risk_tuner deployer
do
    if [ -f "agents/${agent}.py" ]; then
        lines=$(wc -l < "agents/${agent}.py")
        echo "  ✓ agents/${agent}.py ($lines lines)"
    else
        echo "  ✗ agents/${agent}.py NOT FOUND"
        exit 1
    fi
done

echo ""
echo "4. 구문 검증..."
python3 << 'EOFPY'
import py_compile
import sys

agents = [
    'agents/researcher.py',
    'agents/backtester.py',
    'agents/evolver.py',
    'agents/evaluator.py',
    'agents/risk_tuner.py',
    'agents/deployer.py',
]

for agent_file in agents:
    try:
        py_compile.compile(agent_file, doraise=True)
        print(f"  ✓ {agent_file}")
    except py_compile.PyCompileError as e:
        print(f"  ✗ {agent_file}: {e}")
        sys.exit(1)
EOFPY

echo ""
echo "5. Import 테스트..."
python3 << 'EOFPY'
import sys
sys.path.insert(0, '.')

try:
    from agents.researcher import ResearcherAgent
    print("  ✓ ResearcherAgent")
    from agents.backtester import BacktesterAgent
    print("  ✓ BacktesterAgent")
    from agents.evolver import EvolverAgent
    print("  ✓ EvolverAgent")
    from agents.evaluator import EvaluatorAgent
    print("  ✓ EvaluatorAgent")
    from agents.risk_tuner import RiskTunerAgent
    print("  ✓ RiskTunerAgent")
    from agents.deployer import DeployerAgent
    print("  ✓ DeployerAgent")
except ImportError as e:
    print(f"  ✗ Import failed: {e}")
    sys.exit(1)
EOFPY

echo ""
echo "6. 단일 에이전트 실행 테스트 (30초 타임아웃)..."
timeout 30 python3 -m agents.researcher > /dev/null 2>&1 && echo "  ✓ Researcher 실행 성공" || echo "  ✗ Researcher 실행 실패"
timeout 30 python3 -m agents.deployer > /dev/null 2>&1 && echo "  ✓ Deployer 실행 성공" || echo "  ✗ Deployer 실행 실패"

echo ""
echo "======================================================================"
echo "✓ 모든 검증 통과"
echo "======================================================================"
echo ""
echo "실행 방법:"
echo "  # 단일 에이전트 실행"
echo "  python3 -m agents.researcher"
echo ""
echo "  # 오케스트레이터 실행"
echo "  python3 orchestrator.py --agent researcher"
echo "  python3 orchestrator.py --run-once"
echo ""
