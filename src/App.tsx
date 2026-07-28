import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Dashboard from './pages/Dashboard'
import LocationForm from './pages/LocationForm'
import Locations from './pages/Locations'
import MachineData from './pages/MachineData'
import Machines from './pages/Machines'
import MachineLogs from './pages/MachineLogs'
import Placeholder from './pages/Placeholder'
import Calculations from './pages/Calculations'
import DemandEvaluation from './pages/DemandEvaluation'
import Staffing from './pages/Staffing'
import Reports from './pages/Reports'
import SafetyStock from './pages/SafetyStock'
import Settings from './pages/Settings'
import OptimizationCenter from './pages/OptimizationCenter'
import Recommendations from './pages/Recommendations'
import ScenarioLab from './pages/ScenarioLab'
import Forecasting from './pages/Forecasting'
import ResearchMode from './pages/ResearchMode'
import ModelValidation from './pages/ModelValidation'
import EquityAvailability from './pages/EquityAvailability'
import DataManagement from './pages/DataManagement'
import OperationsAnalyzer from './pages/OperationsAnalyzer'
import SyncConflicts from './pages/SyncConflicts'
import Login from './pages/Login'
import Integrations from './pages/Integrations'
import { useAuth } from './context/AuthContext'
function ProtectedLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <AppLayout />
}

export default function App(){return <BrowserRouter><Routes><Route path="/login" element={<Login/>}/><Route element={<ProtectedLayout/>}><Route path="/" element={<Dashboard/>}/><Route path="/operations-analyzer" element={<OperationsAnalyzer/>}/><Route path="/locations" element={<Locations/>}/><Route path="/locations/new" element={<LocationForm/>}/><Route path="/locations/:locationId" element={<LocationForm/>}/><Route path="/machines" element={<Machines/>}/><Route path="/machines/:machineId" element={<MachineData/>}/><Route path="/machines/:machineId/demand-evaluation" element={<DemandEvaluation/>}/><Route path="/inventory" element={<Machines/>}/><Route path="/machine-logs" element={<MachineLogs/>}/><Route path="/data-management" element={<DataManagement/>}/><Route path="/sync-conflicts" element={<SyncConflicts/>}/><Route path="/safety-stock" element={<SafetyStock/>}/><Route path="/staffing" element={<Staffing/>}/><Route path="/reports" element={<Reports/>}/><Route path="/calculations" element={<Calculations/>}/><Route path="/settings" element={<Settings/>}/><Route path="/settings/integrations" element={<Integrations/>}/><Route path="/phase-2/optimization" element={<OptimizationCenter/>}/><Route path="/phase-2/recommendations" element={<Recommendations/>}/><Route path="/phase-2/scenarios" element={<ScenarioLab/>}/><Route path="/phase-2/forecasting" element={<Forecasting/>}/><Route path="/phase-2/research" element={<ResearchMode/>}/><Route path="/phase-2/validation" element={<ModelValidation/>}/><Route path="/phase-2/equity" element={<EquityAvailability/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter>}
