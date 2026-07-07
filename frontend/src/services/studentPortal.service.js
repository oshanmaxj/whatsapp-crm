import axios from 'axios';

const portalApi = axios.create({ baseURL: process.env.REACT_APP_API_URL || 'http://localhost:4000/api' });
portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('studentPortalToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
portalApi.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && window.location.pathname !== '/student/login') {
    localStorage.removeItem('studentPortalToken');
    window.location.assign('/student/login');
  }
  return Promise.reject(error);
});

export const studentLogin = (payload) => portalApi.post('/student-portal/login', payload);
export const verifyStudentOtp = (payload) => portalApi.post('/student-portal/verify-otp', payload);
export const getStudentMe = () => portalApi.get('/student-portal/me');
export const getStudentDashboard = () => portalApi.get('/student-portal/dashboard');
export const getStudentMyCourses = () => portalApi.get('/student-portal/my-courses');
export const getStudentUpcomingClasses = () => portalApi.get('/student-portal/upcoming-classes');
export const getStudentLessons = () => portalApi.get('/student-portal/lessons');
export const getStudentMaterials = () => portalApi.get('/student-portal/materials');
export const getStudentLesson = (id) => portalApi.get(`/student-portal/lessons/${id}`);
export const addStudentLessonComment = (id, payload) => portalApi.post(`/student-portal/lessons/${id}/comments`, payload);
export const updateStudentProgress = (id, payload) => portalApi.post(`/student-portal/lessons/${id}/progress`, payload);
export const joinStudentLiveClass = (id) => portalApi.post(`/student-portal/lessons/${id}/join-live-class`);
export const getStudentPayments = () => portalApi.get('/student-portal/payments');
