interface Props {
    children: React.ReactNode;
}

const Layout = ({ children }: Props) => {
    return (
        <div className="h-screen bg-black">
            <h1 className="text-white">Call Layout</h1>
            {children}
        </div>
    );
}

export default Layout;
