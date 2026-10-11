import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from '@/components/layout'
import { AddProjectScreen } from '@/screens/add-project'
import { ProjectDetailScreen } from '@/screens/project-detail'
import { ProjectsScreen } from '@/screens/projects'
import { SettingsScreen } from '@/screens/settings'
import './index.css'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <ProjectsScreen /> },
      { path: 'add', element: <AddProjectScreen /> },
      { path: 'project/:id', element: <ProjectDetailScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
    ],
  },
])

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('#root element missing in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
