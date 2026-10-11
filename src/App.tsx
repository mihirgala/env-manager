import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/layout'
import { AddProjectScreen } from './screens/add-project'
import { ProjectDetailScreen } from './screens/project-detail'
import { ProjectsScreen } from './screens/projects'
import { SettingsScreen } from './screens/settings'

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

function App(): React.JSX.Element {
  return <RouterProvider router={router} />
}

export default App
